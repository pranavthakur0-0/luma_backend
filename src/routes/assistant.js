/**
 * Assistant Routes - AI chat endpoint
 */

import { Router } from 'express';
import { processMessage, processMessageStream, AI_TOOLS } from '../services/ai.js';

const router = Router();

// POST /assistant/chat - Process user message (non-streaming)
router.post('/chat', async (req, res) => {
    try {
        const { message, context = {}, conversation_history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        const result = await processMessage(message, context, conversation_history);

        res.json({
            response: result.response,
            tool_calls: result.tool_calls,
        });

    } catch (error) {
        console.error('AI chat error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /assistant/chat/stream - Streaming chat with SSE
router.post('/chat/stream', async (req, res) => {
    try {
        const { message, context = {}, conversation_history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const stream = processMessageStream(message, context, conversation_history);

        for await (const chunk of stream) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        res.end();

    } catch (error) {
        console.error('AI stream error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

// GET /assistant/tools - Get available tools
router.get('/tools', (req, res) => {
    const tools = AI_TOOLS.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));

    res.json({ tools });
});

export default router;

