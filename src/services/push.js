/**
 * Gmail Push Notifications Service
 * Handles Gmail watch registration and Pub/Sub webhook
 */

import { google } from 'googleapis';
import { getOAuth2Client } from './gmail.js';
import config from '../config.js';

/**
 * Register Gmail watch for push notifications
 * Must be called for each user to receive notifications for their inbox
 */
export async function registerGmailWatch(accessToken, refreshToken) {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        const response = await gmail.users.watch({
            userId: 'me',
            requestBody: {
                topicName: config.pubsub.topicName,
                labelIds: ['INBOX'],
            },
        });

        console.log('Gmail watch registered:', response.data);
        return {
            historyId: response.data.historyId,
            expiration: response.data.expiration,
        };
    } catch (error) {
        console.error('Failed to register Gmail watch:', error.message);
        throw error;
    }
}

/**
 * Stop watching Gmail for a user
 */
export async function stopGmailWatch(accessToken, refreshToken) {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.stop({ userId: 'me' });
    console.log('Gmail watch stopped');
}

/**
 * Get history of changes since a specific historyId
 * Used to fetch new emails after receiving push notification
 */
export async function getHistory(accessToken, refreshToken, startHistoryId) {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        const response = await gmail.users.history.list({
            userId: 'me',
            startHistoryId,
            historyTypes: ['messageAdded', 'messageDeleted'],
            labelId: 'INBOX',
        });

        return response.data.history || [];
    } catch (error) {
        // 404 means startHistoryId is too old, need full sync
        if (error.code === 404) {
            return null;
        }
        throw error;
    }
}

/**
 * Decode Pub/Sub push notification message
 */
export function decodeNotification(body) {
    if (!body.message?.data) {
        throw new Error('Invalid Pub/Sub message format');
    }

    const dataStr = Buffer.from(body.message.data, 'base64').toString('utf-8');
    const data = JSON.parse(dataStr);

    return {
        emailAddress: data.emailAddress,
        historyId: data.historyId,
        messageId: body.message.messageId,
    };
}
