/**
 * AI Mail Assistant - Express.js Backend
 */

import express from 'express';
import cors from 'cors';
import config from './config.js';
import { connectDB } from './database.js';
import { authMiddleware } from './middleware/auth.js';
import { createSSEHandler, getConnectionCount } from './services/sse.js';

import authRoutes from './routes/auth.js';
import mailRoutes from './routes/mail.js';
import assistantRoutes from './routes/assistant.js';
import webhookRoutes from './routes/webhook.js';
import mongoose from 'mongoose';

const app = express();

// Middleware
app.use(cors({
    origin: [config.frontendUrl, 'http://localhost:5173', 'https://luma-mail.netlify.app'],
    credentials: true,
}));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'healthy',
        app: 'AI Mail Assistant',
        version: '1.0.0',
    });
});

app.get('/health', cors({ origin: '*' }), (req, res) => {
    const mongooseStatus = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting',
        99: 'uninitialized',
    };

    const dbState = mongoose.connection.readyState;

    res.json({
        status: dbState === 1 ? 'healthy' : 'degraded',
        mongodb: mongooseStatus[dbState] || 'unknown',
        gmail_api: config.google.clientId ? 'configured' : 'not configured',
        openai: config.openai.apiKey ? 'configured' : 'not configured',
        pubsub: config.pubsub.topicName ? 'configured' : 'not configured',
        sse_connections: getConnectionCount(),
    });
});

// SSE endpoint for real-time notifications
app.get('/events', createSSEHandler);

// Webhook routes (public - receives from Pub/Sub)
app.use('/webhook', webhookRoutes);

// Public routes (auth has its own protected routes)
app.use('/auth', authRoutes);

// Protected routes (require auth)
app.use('/mail', authMiddleware, mailRoutes);
app.use('/assistant', authMiddleware, assistantRoutes);

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
async function start() {
    try {
        // Start listening FIRST (Crucial for Cloud Health Checks/502s)
        app.listen(config.port, '0.0.0.0', () => {
            console.log(`🚀 Server running on http://0.0.0.0:${config.port}`);
            console.log(`📧 Gmail API: ${config.google.clientId ? '✅ Configured' : '❌ Not configured'}`);
            console.log(`🤖 OpenAI: ${config.openai.apiKey ? '✅ Configured' : '❌ Not configured'}`);
            console.log(`📡 Pub/Sub: ${config.pubsub.topicName !== 'projects/your-project/topics/gmail-notifications' ? '✅ Configured' : '⚠️ Using default'}`);
            console.log(`📺 SSE: ✅ Enabled at /events`);
        });

        // Connect to DB asynchronously
        connectDB();

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();
