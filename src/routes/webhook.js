/**
 * Webhook Routes - Handles external push notifications
 */

import { Router } from 'express';
import { decodeNotification, getHistory } from '../services/push.js';
import { getEmail } from '../services/gmail.js';
import { sendToUser } from '../services/sse.js';
import { User } from '../database.js';

const router = Router();

/**
 * POST /webhook/gmail - Receive Gmail push notifications from Pub/Sub
 * 
 * When a user receives a new email, Pub/Sub sends a notification here.
 * We then fetch the new email(s) and notify the user via WebSocket.
 */
router.post('/gmail', async (req, res) => {
    try {
        // Acknowledge immediately to Pub/Sub (must respond within 10s)
        res.status(200).send('OK');

        // Decode the notification
        const { emailAddress, historyId } = decodeNotification(req.body);
        console.log(`📬 Gmail notification for ${emailAddress}, historyId: ${historyId}`);

        // Find user in database
        const user = await User.findOne({ email: emailAddress });
        if (!user) {
            console.log(`User ${emailAddress} not found in database`);
            return;
        }

        // Get history since last known historyId
        const history = await getHistory(
            user.googleAccessToken,
            user.googleRefreshToken,
            user.lastHistoryId || historyId
        );

        if (history === null) {
            // History too old, notify user to refresh
            sendToUser(emailAddress, 'email:sync_required', {});
            return;
        }

        // Extract new message IDs
        const newMessageIds = [];
        for (const record of history) {
            if (record.messagesAdded) {
                for (const msg of record.messagesAdded) {
                    // Only include INBOX messages
                    if (msg.message.labelIds?.includes('INBOX')) {
                        newMessageIds.push(msg.message.id);
                    }
                }
            }
        }

        if (newMessageIds.length > 0) {
            // Fetch the new emails
            const newEmails = [];
            for (const messageId of newMessageIds.slice(0, 5)) { // Limit to 5
                try {
                    const email = await getEmail(
                        user.googleAccessToken,
                        user.googleRefreshToken,
                        messageId
                    );
                    newEmails.push(email);
                } catch (error) {
                    console.error(`Failed to fetch email ${messageId}:`, error.message);
                }
            }

            // Notify user via SSE
            if (newEmails.length > 0) {
                sendToUser(emailAddress, 'email:new', {
                    count: newEmails.length,
                    emails: newEmails,
                });
            }
        }

        // Update user's lastHistoryId
        await User.updateOne(
            { email: emailAddress },
            { lastHistoryId: historyId }
        );

    } catch (error) {
        console.error('Webhook error:', error);
        // Don't fail the response - already sent 200
    }
});

/**
 * GET /webhook/health - Health check for webhook endpoint
 */
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'gmail-webhook' });
});

export default router;
