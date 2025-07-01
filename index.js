// index.js
// Import necessary libraries
const express = require('express');
const gateApi = require('gate-api');
require('dotenv').config(); // For loading environment variables from a .env file

// --- CONFIGURATION ---
// Load configuration from environment variables for security
const API_KEY = process.env.GATE_API_KEY;
const API_SECRET = process.env.GATE_API_SECRET;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // A secret phrase to secure your webhook
const PORT = process.env.PORT || 3000;

// Check if all required environment variables are set
if (!API_KEY || !API_SECRET || !WEBHOOK_SECRET) {
    console.error("FATAL ERROR: Missing required environment variables (GATE_API_KEY, GATE_API_SECRET, WEBHOOK_SECRET).");
    process.exit(1);
}

// --- GATE.IO API SETUP ---
// Initialize the Gate.io API client
const client = new gateApi.ApiClient();
client.authentications['apiv4'].key = API_KEY;
client.authentications['apiv4'].secret = API_SECRET;
const futuresApi = new gateApi.FuturesApi(client);
const SETTLE_CURRENCY = 'usdt'; // Change if you use btc settle

// --- WEB SERVER SETUP ---
const app = express();
// Use express.json() middleware to automatically parse JSON request bodies
// TradingView can send alerts with a JSON payload
app.use(express.json());

// --- ROUTES ---
// A simple root route to check if the server is running
app.get('/', (req, res) => {
    res.status(200).send('Gate.io Webhook Server is running!');
});

// The main webhook endpoint
app.post('/webhook', async (req, res) => {
    console.log('Webhook received...');
    
    // The request body from TradingView
    const alert = req.body;
    console.log('Alert Body:', JSON.stringify(alert, null, 2));

    // 1. --- SECURITY CHECK ---
    // Verify the secret phrase to ensure the request is from a trusted source (your TradingView alert)
    if (alert.secret !== WEBHOOK_SECRET) {
        console.warn('Unauthorized webhook attempt. Invalid secret.');
        return res.status(401).send('Unauthorized');
    }
    console.log('Webhook secret verified.');

    // 2. --- VALIDATE ALERT DATA ---
    // Check if the alert contains the necessary information to place an order
    const { contract, size, side } = alert;
    if (!contract || !size || !side) {
        console.error('Invalid alert data. Missing "contract", "size", or "side".');
        return res.status(400).send('Bad Request: Missing required fields.');
    }

    try {
        // 3. --- CREATE THE ORDER ---
        console.log(`Attempting to place order: ${side} ${size} of ${contract}`);

        // Gate.io API uses a positive size for long (buy) and negative for short (sell)
        const orderSize = side.toLowerCase() === 'sell' ? -Math.abs(size) : Math.abs(size);

        const futuresOrder = new gateApi.FuturesOrder();
        futuresOrder.contract = contract; // e.g., "BTC_USDT"
        futuresOrder.size = orderSize;    // Number of contracts, negative for short
        futuresOrder.tif = 'ioc';         // Time in force: 'ioc' (Immediate Or Cancel) is safest for market orders
        // For market orders, you don't set a price. The API will execute at the best available price.
        // If you want a limit order, add: futuresOrder.price = alert.price; and change tif to 'gtc'

        // 4. --- EXECUTE THE TRADE ---
        const result = await futuresApi.createFuturesOrder(SETTLE_CURRENCY, futuresOrder);
        console.log('Successfully placed order:', result.body);
        
        // Respond to TradingView with a success message
        res.status(200).json({
            status: 'success',
            message: 'Order placed successfully',
            orderId: result.body.id
        });

    } catch (error) {
        console.error('Error placing order with Gate.io:', error.body || error.message);
        
        // Respond to TradingView with an error message
        res.status(500).json({
            status: 'error',
            message: 'Failed to place order',
            error: error.body || error.message
        });
    }
});

// --- START THE SERVER ---
app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});