import mongoose from 'mongoose';
import config from './config.js';

export async function connectDB() {
    try {
        await mongoose.connect(config.mongodb.url);
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        // Don't exit process - allow health check to report status
    }
}

// User schema
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    name: String,
    picture: String,
    googleAccessToken: String,
    googleRefreshToken: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    watchExpiration: { type: Number }, // Timestamp when watch expires
    lastHistoryId: { type: String },   // Last synced historyId
});

export const User = mongoose.model('User', userSchema);
