/**
 * Assistant Routes - AI chat endpoint
 */

import { Router } from 'express';
import { processMessage, processMessageStream, AI_TOOLS } from '../services/ai.js';
import { Conversation } from '../models/Conversation.js';

const router = Router();

// GET /assistant/conversations - Get all conversations for user
router.get('/conversations', async (req, res) => {
    try {
        const conversations = await Conversation.find({ userId: req.user.userId })
            .select('title lastMessageAt createdAt')
            .sort({ lastMessageAt: -1 })
            .limit(50); // Limit to last 50 for performance

        res.json(conversations);
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /assistant/conversations/:id - Get a specific conversation
router.get('/conversations/:id', async (req, res) => {
    try {
        const conversation = await Conversation.findOne({
            _id: req.params.id,
            userId: req.user.userId
        });

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        res.json(conversation);
    } catch (error) {
        console.error('Get conversation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /assistant/conversations/:id - Delete a conversation
router.delete('/conversations/:id', async (req, res) => {
    try {
        const result = await Conversation.deleteOne({
            _id: req.params.id,
            userId: req.user.userId
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete conversation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// PATCH /assistant/conversations/:id - Update conversation title
router.patch('/conversations/:id', async (req, res) => {
    try {
        const { title } = req.body;
        const conversation = await Conversation.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            { title },
            { new: true }
        );

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        res.json(conversation);
    } catch (error) {
        console.error('Update conversation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /assistant/chat - Process user message (non-streaming)
router.post('/chat', async (req, res) => {
    try {
        const { message, context = {}, conversationId } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        // 1. Get or create conversation
        let conversation;
        if (conversationId) {
            conversation = await Conversation.findOne({ _id: conversationId, userId: req.user.userId });
        }

        if (!conversation) {
            conversation = new Conversation({
                userId: req.user.userId,
                title: message.substring(0, 30) + (message.length > 30 ? '...' : ''), // Simple auto-title
                messages: []
            });
        }

        // 2. Add user message
        conversation.messages.push({
            role: 'user',
            content: message,
            timestamp: new Date()
        });

        // 3. Get history for AI context
        // Only verify last 10 messages for context window efficiency
        const historyForAI = conversation.messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content
        }));

        // 4. Process with AI
        const result = await processMessage(message, context, historyForAI);

        // 5. Add AI response
        conversation.messages.push({
            role: 'assistant',
            content: result.response,
            tool_calls: result.tool_calls,
            timestamp: new Date()
        });

        // 6. Save conversation
        await conversation.save();

        res.json({
            response: result.response,
            tool_calls: result.tool_calls,
            conversationId: conversation._id,
            title: conversation.title
        });

    } catch (error) {
        console.error('AI chat error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /assistant/chat/stream - Streaming chat with SSE
router.post('/chat/stream', async (req, res) => {
    try {
        const { message, context = {}, conversationId } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // 1. Get or create conversation
        let conversation;
        if (conversationId) {
            conversation = await Conversation.findOne({ _id: conversationId, userId: req.user.userId });
        }

        if (!conversation) {
            conversation = new Conversation({
                userId: req.user.userId,
                title: message.substring(0, 30) + (message.length > 30 ? '...' : ''),
                messages: []
            });
        }

        // 2. Add user message to DB
        conversation.messages.push({
            role: 'user',
            content: message,
            timestamp: new Date()
        });
        await conversation.save(); // Save immediately to persist user msg

        // 3. Get history for AI
        const historyForAI = conversation.messages.slice(-11, -1).map(m => ({
            role: m.role,
            content: m.content
        }));

        const stream = processMessageStream(message, context, historyForAI);

        let fullResponse = '';
        let toolCalls = [];

        for await (const chunk of stream) {
            if (chunk.type === 'text') {
                fullResponse += chunk.content;
            } else if (chunk.type === 'tool_calls') {
                toolCalls = chunk.tool_calls;
            }
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        // 4. Save AI response to DB after stream
        conversation.messages.push({
            role: 'assistant',
            content: fullResponse,
            tool_calls: toolCalls,
            timestamp: new Date()
        });

        // Update title if it's the first message and title is default/simple
        if (conversation.messages.length <= 2) {
            // Let client handle title generation or keep simple truncation
        }

        await conversation.save();

        // Send conversation ID update
        res.write(`data: ${JSON.stringify({ type: 'meta', conversationId: conversation._id, title: conversation.title })}\n\n`);

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
