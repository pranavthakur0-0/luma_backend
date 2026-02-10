/**
 * Mail Routes - Email CRUD operations
 */

import { Router } from 'express';
import * as gmail from '../services/gmail.js';

const router = Router();

// GET /mail/inbox - Get inbox emails
router.get('/inbox', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;

        const options = {
            maxResults: parseInt(req.query.max_results) || 20,
            pageToken: req.query.page_token,
            from_address: req.query.from_address,
            after_date: req.query.after_date,
            before_date: req.query.before_date,
            is_unread: req.query.is_unread === 'true' ? true : req.query.is_unread === 'false' ? false : undefined,
            query: req.query.query,
        };

        console.log(`📥 Fetching inbox (max: ${options.maxResults})...`);
        const start = Date.now();

        const result = await gmail.getInbox(googleAccessToken, googleRefreshToken, options);

        const duration = Date.now() - start;
        const payloadSize = JSON.stringify(result).length;
        const sizeKB = (payloadSize / 1024).toFixed(2);

        console.log(`✅ Inbox fetched in ${duration}ms | Payload: ${sizeKB}KB | Count: ${result.emails.length}`);
        res.json(result);

    } catch (error) {
        console.error('Get inbox error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /mail/count - Get total email count for pagination
router.get('/count', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;
        const label = req.query.label || 'INBOX';

        const count = await gmail.getEmailCount(googleAccessToken, googleRefreshToken, label);
        res.json({ count, label });
    } catch (error) {
        console.error('Get email count error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /mail/sent - Get sent emails
router.get('/sent', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;

        const options = {
            maxResults: parseInt(req.query.max_results) || 20,
            pageToken: req.query.page_token,
        };

        const result = await gmail.getSent(googleAccessToken, googleRefreshToken, options);
        res.json(result);

    } catch (error) {
        console.error('Get sent error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /mail/search - Search emails
router.get('/search', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;
        const query = req.query.q;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter q is required' });
        }

        const maxResults = parseInt(req.query.max_results) || 20;
        const result = await gmail.searchEmails(googleAccessToken, googleRefreshToken, query, maxResults);
        res.json(result);

    } catch (error) {
        console.error('Search emails error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /mail/:id - Get single email
router.get('/:id', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;
        const emailId = req.params.id;

        const email = await gmail.getEmail(googleAccessToken, googleRefreshToken, emailId);
        res.json(email);

    } catch (error) {
        console.error('Get email error:', error);
        res.status(404).json({ error: 'Email not found' });
    }
});

// GET /mail/thread/:id - Get email thread
router.get('/thread/:id', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;
        const threadId = req.params.id;

        const messages = await gmail.getThread(googleAccessToken, googleRefreshToken, threadId);
        res.json(messages);

    } catch (error) {
        console.error('Get thread error:', error);
        res.status(404).json({ error: 'Thread not found' });
    }
});

// POST /mail/send - Send email
router.post('/send', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;
        const { to, cc, bcc, subject, body, reply_to_message_id } = req.body;

        if (!to || !subject) {
            return res.status(400).json({ error: 'to and subject are required' });
        }

        const email = await gmail.sendEmail(googleAccessToken, googleRefreshToken, {
            to,
            cc,
            bcc,
            subject,
            body: body || '',
            replyToId: reply_to_message_id,
        });

        res.json(email);

    } catch (error) {
        console.error('Send email error:', error);
        res.status(400).json({ error: error.message });
    }
});

// POST /mail/:id/read - Mark as read
router.post('/:id/read', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;
        await gmail.markAsRead(googleAccessToken, googleRefreshToken, req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// POST /mail/:id/unread - Mark as unread
router.post('/:id/unread', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;
        await gmail.markAsUnread(googleAccessToken, googleRefreshToken, req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// DELETE /mail/:id - trash email
router.delete('/:id', async (req, res) => {
    try {
        const { googleAccessToken, googleRefreshToken } = req.user;
        await gmail.trashEmail(googleAccessToken, googleRefreshToken, req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

export default router;
