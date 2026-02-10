/**
 * Gmail Service - Handles all Gmail API operations
 */

import { google } from 'googleapis';
import config from '../config.js';

const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

export function getOAuth2Client() {
    return new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
        config.google.redirectUri
    );
}

export function getAuthUrl() {
    const oauth2Client = getOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });
}

export async function getTokensFromCode(code) {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
}

export async function getUserInfo(accessToken) {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    return data;
}

function getGmailClient(accessToken, refreshToken) {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
    });
    return google.gmail({ version: 'v1', auth: oauth2Client });
}

function parseEmailAddress(raw) {
    if (!raw) return { email: '', name: null };

    const match = raw.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
    if (match) {
        return {
            name: match[1] || null,
            email: match[2] || raw,
        };
    }
    return { email: raw, name: null };
}

function getHeader(headers, name) {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header?.value || '';
}

function decodeBase64(data) {
    return Buffer.from(data, 'base64').toString('utf-8');
}

function extractBody(payload) {
    let textBody = null;
    let htmlBody = null;

    function processPart(part) {
        const mimeType = part.mimeType || '';

        if (mimeType === 'text/plain' && part.body?.data) {
            textBody = decodeBase64(part.body.data);
        } else if (mimeType === 'text/html' && part.body?.data) {
            htmlBody = decodeBase64(part.body.data);
        } else if (part.parts) {
            part.parts.forEach(processPart);
        }
    }

    if (payload.parts) {
        payload.parts.forEach(processPart);
    } else if (payload.body?.data) {
        const body = decodeBase64(payload.body.data);
        if (payload.mimeType === 'text/html') {
            htmlBody = body;
        } else {
            textBody = body;
        }
    }

    return { textBody, htmlBody };
}

function parseMessage(message, includeBody = false) {
    const headers = message.payload?.headers || [];

    const fromRaw = getHeader(headers, 'From');
    const toRaw = getHeader(headers, 'To');
    const ccRaw = getHeader(headers, 'Cc');
    const bccRaw = getHeader(headers, 'Bcc');
    const subject = getHeader(headers, 'Subject') || '(No Subject)';
    const dateStr = getHeader(headers, 'Date');

    let date;
    try {
        date = new Date(dateStr);
    } catch {
        date = new Date();
    }

    const email = {
        id: message.id,
        threadId: message.threadId,
        subject,
        snippet: message.snippet || '',
        from_address: parseEmailAddress(fromRaw),
        to_addresses: toRaw.split(',').map(addr => parseEmailAddress(addr.trim())).filter(a => a.email),
        cc_addresses: ccRaw ? ccRaw.split(',').map(addr => parseEmailAddress(addr.trim())).filter(a => a.email) : [],
        bcc_addresses: bccRaw ? bccRaw.split(',').map(addr => parseEmailAddress(addr.trim())).filter(a => a.email) : [],
        date: date.toISOString(),
        is_read: !message.labelIds?.includes('UNREAD'),
        labels: message.labelIds || [],
    };

    if (includeBody) {
        const { textBody, htmlBody } = extractBody(message.payload);
        email.body_text = textBody;
        email.body_html = htmlBody;
    }

    return email;
}

export async function getInbox(accessToken, refreshToken, options = {}) {
    const gmail = getGmailClient(accessToken, refreshToken);

    let query = 'in:inbox';
    if (options.from_address) query += ` from:${options.from_address}`;
    if (options.after_date) {
        // Gmail expects YYYY/MM/DD format, not ISO string
        const date = new Date(options.after_date);
        const formatted = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
        query += ` after:${formatted}`;
    }
    if (options.before_date) {
        const date = new Date(options.before_date);
        const formatted = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
        query += ` before:${formatted}`;
    }
    if (options.is_unread === true) query += ' is:unread';
    if (options.is_unread === false) query += ' is:read';
    if (options.query) query += ` ${options.query}`;

    console.log('Gmail query:', query); // Debug log

    const listStart = Date.now();
    const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: options.maxResults || 20,
        pageToken: options.pageToken,
    });
    console.log(`   Internal: List IDs took ${Date.now() - listStart}ms`);

    const messages = listResponse.data.messages || [];
    const emails = [];

    const fetchStart = Date.now();
    console.log(`   Internal: Serving ${messages.length} messages...`);

    // Parallel fetch for better performance
    const promises = messages.map(async (msg) => {
        const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
            fields: 'id,threadId,labelIds,snippet,internalDate,payload(headers)',
        });
        return parseMessage(fullMessage.data);
    });

    const results = await Promise.all(promises);
    emails.push(...results);

    console.log(`   Internal: Fetching details took ${Date.now() - fetchStart}ms`);

    return {
        emails,
        nextPageToken: listResponse.data.nextPageToken,
    };
}

export async function getSent(accessToken, refreshToken, options = {}) {
    const gmail = getGmailClient(accessToken, refreshToken);

    const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: 'in:sent',
        maxResults: options.maxResults || 20,
        pageToken: options.pageToken,
    });

    const messages = listResponse.data.messages || [];

    // Parallel fetch for better performance
    const promises = messages.map(async (msg) => {
        const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
            fields: 'id,threadId,labelIds,snippet,internalDate,payload(headers)',
        });
        return parseMessage(fullMessage.data);
    });

    const emails = await Promise.all(promises);

    return {
        emails,
        nextPageToken: listResponse.data.nextPageToken,
    };
}

export async function getEmail(accessToken, refreshToken, emailId) {
    const gmail = getGmailClient(accessToken, refreshToken);

    const response = await gmail.users.messages.get({
        userId: 'me',
        id: emailId,
        format: 'full',
    });

    return parseMessage(response.data, true);
}

export async function sendEmail(accessToken, refreshToken, { to, cc, bcc, subject, body, replyToId }) {
    const gmail = getGmailClient(accessToken, refreshToken);

    const toList = Array.isArray(to) ? to.join(', ') : to;
    const ccList = cc && (Array.isArray(cc) ? cc.join(', ') : cc);
    const bccList = bcc && (Array.isArray(bcc) ? bcc.join(', ') : bcc);

    let messageParts = [
        `To: ${toList}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=utf-8',
    ];

    if (ccList) messageParts.splice(1, 0, `Cc: ${ccList}`);
    if (bccList) messageParts.splice(1, 0, `Bcc: ${bccList}`); // Order doesn't strictly matter for headers but nice to keep together

    const rawMessage = [
        ...messageParts,
        '',
        body,
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const requestBody = { raw: encodedMessage };
    if (replyToId) {
        requestBody.threadId = replyToId;
    }

    const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody,
    });

    return getEmail(accessToken, refreshToken, response.data.id);
}

export async function searchEmails(accessToken, refreshToken, query, maxResults = 20) {
    const gmail = getGmailClient(accessToken, refreshToken);

    const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
    });

    const messages = listResponse.data.messages || [];

    // Parallel fetch for better performance
    const promises = messages.map(async (msg) => {
        const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
            fields: 'id,threadId,labelIds,snippet,internalDate,payload(headers)',
        });
        return parseMessage(fullMessage.data);
    });

    const emails = await Promise.all(promises);

    return {
        emails,
        nextPageToken: listResponse.data.nextPageToken,
    };
}

export async function markAsRead(accessToken, refreshToken, emailId) {
    const gmail = getGmailClient(accessToken, refreshToken);

    await gmail.users.messages.modify({
        userId: 'me',
        id: emailId,
        requestBody: {
            removeLabelIds: ['UNREAD'],
        },
    });

    return true;
}

export async function markAsUnread(accessToken, refreshToken, emailId) {
    const gmail = getGmailClient(accessToken, refreshToken);

    await gmail.users.messages.modify({
        userId: 'me',
        id: emailId,
        requestBody: {
            addLabelIds: ['UNREAD'],
        },
    });

    return true;
}

export async function trashEmail(accessToken, refreshToken, emailId) {
    const gmail = getGmailClient(accessToken, refreshToken);

    await gmail.users.messages.trash({
        userId: 'me',
        id: emailId,
    });

    return true;
}

export async function getEmailCount(accessToken, refreshToken, labelId = 'INBOX') {
    const gmail = getGmailClient(accessToken, refreshToken);

    const { data } = await gmail.users.labels.get({
        userId: 'me',
        id: labelId,
    });

    return data.messagesTotal || 0;
}

export async function getThread(accessToken, refreshToken, threadId) {
    const gmail = getGmailClient(accessToken, refreshToken);

    const response = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
    });

    if (!response.data.messages) return [];

    return response.data.messages.map(msg => parseMessage(msg, true));
}

