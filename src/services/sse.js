/**
 * SSE (Server-Sent Events) Service
 * Manages real-time connections with clients - lighter than WebSocket
 */

import jwt from 'jsonwebtoken';
import config from '../config.js';

// Store active SSE connections by user email
const connections = new Map(); // email -> Set of response objects

/**
 * SSE endpoint handler
 * Clients connect via: GET /events
 */
export function createSSEHandler(req, res) {
    // Get token from query or header
    const token = req.query.token || req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }

    let user;
    try {
        user = jwt.verify(token, config.jwt.secret);
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    const email = user.sub;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // For nginx
    res.flushHeaders();

    // Send initial connection message
    res.write(`event: connected\ndata: ${JSON.stringify({ email })}\n\n`);

    // Track this connection
    if (!connections.has(email)) {
        connections.set(email, new Set());
    }
    connections.get(email).add(res);

    console.log(`📱 SSE connected: ${email} (${connections.get(email).size} connections)`);

    // Keep-alive ping every 30 seconds
    const keepAlive = setInterval(() => {
        res.write(`: ping\n\n`);
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
        clearInterval(keepAlive);
        const userConns = connections.get(email);
        if (userConns) {
            userConns.delete(res);
            if (userConns.size === 0) {
                connections.delete(email);
            }
        }
        console.log(`📴 SSE disconnected: ${email}`);
    });
}

/**
 * Send event to a specific user
 */
export function sendToUser(email, event, data) {
    const userConns = connections.get(email);

    if (!userConns || userConns.size === 0) {
        console.log(`No SSE connections for ${email}`);
        return false;
    }

    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const res of userConns) {
        res.write(message);
    }

    console.log(`📨 SSE sent to ${email}: ${event}`);
    return true;
}

/**
 * Broadcast to all connected users
 */
export function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const [email, userConns] of connections) {
        for (const res of userConns) {
            res.write(message);
        }
    }
}

/**
 * Get count of active connections
 */
export function getConnectionCount() {
    let count = 0;
    for (const userConns of connections.values()) {
        count += userConns.size;
    }
    return count;
}
