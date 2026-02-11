import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        required: true,
        enum: ['user', 'assistant', 'system']
    },
    content: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        default: 'text' // text, error, info, success, etc.
    },
    tool_calls: [{
        id: String,
        name: String,
        arguments: mongoose.Schema.Types.Mixed
    }],
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        default: 'New Conversation'
    },
    messages: [messageSchema],
    lastMessageAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Update lastMessageAt on save if messages modified
conversationSchema.pre('save', function (next) {
    if (this.isModified('messages')) {
        this.lastMessageAt = new Date();
    }
    next();
});

export const Conversation = mongoose.model('Conversation', conversationSchema);
