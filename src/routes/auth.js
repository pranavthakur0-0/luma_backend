/**
 * Auth Routes - Google OAuth flow
 */

import { Router } from 'express';
import { getAuthUrl, getTokensFromCode, getUserInfo } from '../services/gmail.js';
import { createToken, authMiddleware } from '../middleware/auth.js';
import { User } from '../database.js';
import config from '../config.js';

const router = Router();

// GET /auth/google - Get Google OAuth URL
router.get('/google', (req, res) => {
    const authUrl = getAuthUrl();
    res.json({ authorization_url: authUrl });
});

// GET /auth/callback - Handle OAuth callback
router.get('/callback', async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.redirect(`${config.frontendUrl}/auth/error?message=No code provided`);
        }

        // Exchange code for tokens
        const tokens = await getTokensFromCode(code);

        // Get user info
        const userInfo = await getUserInfo(tokens.access_token);

        // Upsert user in database
        const user = await User.findOneAndUpdate(
            { email: userInfo.email },
            {
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                googleAccessToken: tokens.access_token,
                googleRefreshToken: tokens.refresh_token,
                updatedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        // Create JWT
        const jwtToken = createToken({
            sub: userInfo.email,
            userId: user._id, // Add userId to token
            name: userInfo.name,
            picture: userInfo.picture,
            googleAccessToken: tokens.access_token,
            googleRefreshToken: tokens.refresh_token,
        });

        // Redirect to frontend with token
        res.redirect(`${config.frontendUrl}/auth/success?token=${jwtToken}`);

    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect(`${config.frontendUrl}/auth/error?message=${encodeURIComponent(error.message)}`);
    }
});

// GET /auth/me - Get current user info (protected)
router.get('/me', authMiddleware, (req, res) => {
    res.json({
        email: req.user.sub,
        name: req.user.name,
        picture: req.user.picture,
    });
});

// POST /auth/watch - Register Gmail push notifications (protected)
router.post('/watch', authMiddleware, async (req, res) => {
    try {
        const { registerGmailWatch } = await import('../services/push.js');

        const user = await User.findOne({ email: req.user.sub });

        // Optimization #5: Check if watch is still valid (buffer 1 hour)
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;

        if (user?.watchExpiration && user.watchExpiration > (now + oneHour)) {
            console.log(`⏱️ Watch already active for ${user.email}, expiring in ${Math.round((user.watchExpiration - now) / 60000)} mins`);
            return res.json({
                success: true,
                historyId: user.lastHistoryId,
                expiration: user.watchExpiration,
                skipped: true
            });
        }

        const result = await registerGmailWatch(
            req.user.googleAccessToken,
            req.user.googleRefreshToken
        );

        // Update DB
        await User.findOneAndUpdate(
            { email: req.user.sub },
            {
                watchExpiration: result.expiration,
                lastHistoryId: result.historyId
            }
        );

        res.json({
            success: true,
            historyId: result.historyId,
            expiration: result.expiration,
        });
    } catch (error) {
        console.error('Watch registration error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;
