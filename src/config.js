import dotenv from 'dotenv';
dotenv.config();

export default {
    port: process.env.PORT || 8000,
    nodeEnv: process.env.NODE_ENV || 'development',

    mongodb: {
        url: process.env.MONGODB_URL || 'mongodb://localhost:27017/ai_mail',
    },

    google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8000/auth/callback',
    },

    openai: {
        apiKey: process.env.OPENAI_API_KEY,
    },

    pubsub: {
        // Format: projects/PROJECT_ID/topics/TOPIC_NAME
        topicName: process.env.PUBSUB_TOPIC_NAME || 'projects/your-project/topics/gmail-notifications',
    },

    jwt: {
        secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },

    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    backendUrl: process.env.BACKEND_URL || 'http://localhost:8000',
};
