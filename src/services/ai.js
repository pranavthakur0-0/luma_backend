/**
 * AI Service - OpenAI integration with tool calling for UI control
 */

import OpenAI from 'openai/index.mjs';
import config from '../config.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Define tools the AI can call to control the UI
const AI_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'compose_email',
            description: 'Open the compose view and fill in the email fields. Call this when the user wants to write or draft an email.',
            parameters: {
                type: 'object',
                properties: {
                    to: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of recipient email addresses',
                    },
                    cc: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of CC recipient email addresses',
                    },
                    bcc: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of BCC recipient email addresses',
                    },
                    subject: {
                        type: 'string',
                        description: 'Email subject line',
                    },
                    body: {
                        type: 'string',
                        description: 'Email body content. MUST serve valid HTML content with proper formatting (paragraphs, line breaks, etc). Use <br> for line breaks and <p> for paragraphs. Should start with a professional greeting and end with a sign-off.',
                    },
                },
                required: ['to', 'subject', 'body'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'send_email',
            description: 'Send the email that is currently in the compose form. Only call after compose_email has filled the form.',
            parameters: {
                type: 'object',
                properties: {
                    confirm: {
                        type: 'boolean',
                        description: 'Confirmation to send. Should always be true when called.',
                    },
                },
                required: ['confirm'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_emails',
            description: 'Search emails and display results in the main view. Use for finding specific emails.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query (can include from:, subject:, etc.)',
                    },
                    from_address: {
                        type: 'string',
                        description: 'Filter by sender email or name',
                    },
                    subject_contains: {
                        type: 'string',
                        description: 'Filter by subject containing this text',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'filter_emails',
            description: 'Apply filters to the inbox view. Updates the displayed emails based on criteria.',
            parameters: {
                type: 'object',
                properties: {
                    days_ago: {
                        type: 'integer',
                        description: 'Show emails from the last N days',
                    },
                    is_unread: {
                        type: 'boolean',
                        description: 'Filter by unread status',
                    },
                    from_address: {
                        type: 'string',
                        description: 'Filter by sender',
                    },
                    has_attachment: {
                        type: 'boolean',
                        description: 'Filter emails with attachments',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'open_email',
            description: "Open a specific email to view its full content. You can specify an email ID directly, provide a search description to find it, or use a list position (e.g., 1 for the first email).",
            parameters: {
                type: "object",
                properties: {
                    email_id: {
                        type: "string",
                        description: "The unique ID of the email to open (if known)."
                    },
                    description: {
                        type: "string",
                        description: "A description of the email to find (e.g., 'email from John about meeting', 'latest invoice')."
                    },
                    list_position: {
                        type: "integer",
                        description: "The position of the email in the current list to open (1-based index). Use this when the user refers to 'first', 'second', 'last', etc. For 'last', use 0 or -1 contextually, or better yet, infer the index if possible, otherwise rely on description."
                    }
                },
                required: []
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'navigate',
            description: 'Navigate to a different view in the mail app.',
            parameters: {
                type: 'object',
                properties: {
                    view: {
                        type: 'string',
                        enum: ['inbox', 'sent', 'compose'],
                        description: 'The view to navigate to',
                    },
                },
                required: ['view'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'reply_to_email',
            description: 'Reply to the currently open email or a specific email. Opens compose with reply context.',
            parameters: {
                type: 'object',
                properties: {
                    email_id: {
                        type: 'string',
                        description: 'ID of email to reply to. If not provided, replies to currently open email.',
                    },
                    body: {
                        type: 'string',
                        description: 'Reply message content',
                    },
                },
                required: [],
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'delete_email',
            description: 'Delete a specific email permanently. Use with caution.',
            parameters: {
                type: 'object',
                properties: {
                    email_id: {
                        type: 'string',
                        description: 'The ID of the email to delete',
                    },
                },
                required: ['email_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'mark_as_read',
            description: 'Mark an specific email as read or unread.',
            parameters: {
                type: 'object',
                properties: {
                    email_id: {
                        type: 'string',
                        description: 'The ID of the email',
                    },
                    is_read: {
                        type: 'boolean',
                        description: 'True to mark as read, false to mark as unread',
                    },
                },
                required: ['email_id', 'is_read'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'refresh_inbox',
            description: 'Check for new emails and refresh the inbox view.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
];

const SYSTEM_PROMPT = `You are an AI assistant in a conversational chatbot interface. You can render interactive UI components directly in your responses to create rich, visual interactions.

**Email Formatting Rules:**
When drafting an email (compose_email or reply_to_email):
1. **Professional Formatting**: Always use a proper greeting (e.g., "Hi [Name],") and sign-off (e.g., "Best regards, [Name]").
2. **Structure**: Use clear paragraphs for readability.
3. **HTML**: The body content MUST be formatted with simple HTML tags (<p>, <br>, <ul>, <li>) to ensure it renders correctly in the email client. Do not use Markdown for the email body.
4. **Context**: Use the provided context (previous emails, user request) to draft relevant and concise content.

**Component Rendering:**
To display UI components, include special markers in your responses:
Format: [COMPONENT:ComponentName {"prop": "value", "prop2": 123}]

**Available Components:**

1. **EmailCard** - Display email information
   [COMPONENT:EmailCard {"sender": "John Doe", "subject": "Meeting Tomorrow", "preview": "Just confirming our 2pm meeting", "timestamp": "10 minutes ago", "content": "Full email content here"}]

2. **DataTable** - Display tabular data
   [COMPONENT:DataTable {"title": "Sales Data", "columns": [{"key": "name", "label": "Name"}, {"key": "value", "label": "Value"}], "data": [{"name": "Q1", "value": 1500}, {"name": "Q2", "value": 2300}]}]

3. **Chart** - Visualize data with charts
   [COMPONENT:Chart {"type": "bar", "title": "Monthly Sales", "data": [{"label": "Jan", "value": 100}, {"label": "Feb", "value": 150}]}]
   Types: "bar" or "line"

4. **Form** - Interactive forms
   [COMPONENT:Form {"title": "Contact Form", "submitLabel": "Send", "fields": [{"name": "email", "label": "Email", "type": "email", "required": true}, {"name": "message", "label": "Message", "type": "textarea"}]}]

5. **Actions** - Action buttons
   [COMPONENT:Actions {"actions": [{"label": "Confirm", "icon": "✅", "primary": true}, {"label": "Cancel", "icon": "❌"}]}]

**Usage Examples:**

User: "Show me sample emails"
You: "Here are some recent emails:
[COMPONENT:EmailCard {"sender": "team@company.com", "subject": "Weekly Update", "preview": "Here's what happened this week..."}]
[COMPONENT:EmailCard {"sender": "boss@company.com", "subject": "Project Review", "preview": "Can we meet to discuss the project?"}]"

User: "Show me a sales chart"
You: "Here's your sales performance:
[COMPONENT:Chart {"type": "bar", "title": "Q1 Sales", "data": [{"label": "Jan", "value": 12000}, {"label": "Feb", "value": 15000}, {"label": "Mar", "value": 18000}]}]"

User: "Create a contact form"
You: "Here's a contact form for you:
[COMPONENT:Form {"title": "Get in Touch", "fields": [{"name": "name", "label": "Your Name", "type": "text", "required": true}, {"name": "email", "label": "Email", "type": "email", "required": true}, {"name": "message", "label": "Message", "type": "textarea"}]}]"

**Guidelines:**
- Use components when visual representation adds value
- Combine text with components for context
- Make data realistic and relevant to the conversation
- Keep component props valid JSON
- Be creative in demonstrating capabilities

Current Context:
{context}

Remember: You can mix regular text with components to create engaging, interactive responses!`;

function formatContext(context) {
    const lines = [];

    if (context.current_view) {
        lines.push(`- Current view: ${context.current_view}`);
    }

    if (context.open_email) {
        lines.push(`- Currently viewing email from: ${context.open_email.from || 'Unknown'}`);
        lines.push(`- Subject: ${context.open_email.subject || 'No subject'}`);
    }

    if (context.compose_draft) {
        const draft = context.compose_draft;
        lines.push(`- Compose form has: To=${draft.to || ''}, Subject=${draft.subject || ''}`);
    }

    if (context.recent_emails?.length) {
        lines.push('- Recent emails available for reference:');
        context.recent_emails.slice(0, 5).forEach((email, i) => {
            lines.push(`  ${i + 1}. From: ${email.from || 'Unknown'} - ${email.subject || 'No subject'} (ID: ${email.id})`);
        });
    }

    return lines.length ? lines.join('\n') : 'No specific context available.';
}

export async function processMessage(message, context, conversationHistory = []) {
    const contextStr = formatContext(context);

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT.replace('{context}', contextStr) },
        ...conversationHistory,
        { role: 'user', content: message },
    ];

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        tools: AI_TOOLS,
        tool_choice: 'auto',
    });

    const assistantMessage = response.choices[0].message;

    const result = {
        response: assistantMessage.content || '',
        tool_calls: [],
    };

    if (assistantMessage.tool_calls) {
        for (const toolCall of assistantMessage.tool_calls) {
            result.tool_calls.push({
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: JSON.parse(toolCall.function.arguments),
            });
        }
    }

    return result;
}

/**
 * Process a message with streaming response
 * Yields text chunks as they arrive, returns tool calls at the end
 */
export async function* processMessageStream(message, context, conversationHistory = []) {
    const contextStr = formatContext(context);

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT.replace('{context}', contextStr) },
        ...conversationHistory,
        { role: 'user', content: message },
    ];

    const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        tools: AI_TOOLS,
        tool_choice: 'auto',
        stream: true,
    });

    let collectedToolCalls = [];
    let currentToolCall = null;

    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Yield text content as it streams
        if (delta?.content) {
            yield { type: 'text', content: delta.content };
        }

        // Collect tool calls
        if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
                if (tc.index !== undefined) {
                    if (!collectedToolCalls[tc.index]) {
                        collectedToolCalls[tc.index] = {
                            id: tc.id || '',
                            name: tc.function?.name || '',
                            arguments: ''
                        };
                    }
                    if (tc.id) collectedToolCalls[tc.index].id = tc.id;
                    if (tc.function?.name) collectedToolCalls[tc.index].name = tc.function.name;
                    if (tc.function?.arguments) collectedToolCalls[tc.index].arguments += tc.function.arguments;
                }
            }
        }
    }

    // Parse and yield tool calls at the end
    const parsedToolCalls = collectedToolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments ? JSON.parse(tc.arguments) : {}
    }));

    if (parsedToolCalls.length > 0) {
        yield { type: 'tool_calls', tool_calls: parsedToolCalls };
    }

    yield { type: 'done' };
}

export { AI_TOOLS };
