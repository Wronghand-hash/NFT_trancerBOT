import express from 'express';
import path from 'path';
import { bot } from './index';

const app = express();
const port = Number(process.env.PORT) || 10000;
const host = '0.0.0.0';

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (_req, res) => {
    const botStatus = bot.telegram ? '🟢 Running' : '🔴 Not Running';
    res.send(`
        <html>
            <head>
                <title>NFT Tracker Bot Status</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    .status { font-size: 24px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <h1>NFT Tracker Bot</h1>
                <div class="status">Status: ${botStatus}</div>
            </body>
        </html>
    `);
});

// Add health check endpoint
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', bot: bot.telegram ? 'connected' : 'disconnected' });
});

export function startServer() {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            console.log(`Server running on http://${host}:${port}`);
            resolve(server);
        }).on('error', (err) => {
            console.error('Server startup error:', err);
            reject(err);
        });

        // Handle graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM received. Starting graceful shutdown...');
            server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            console.log('SIGINT received. Starting graceful shutdown...');
            server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
        });
    });
}

// Only start the server if this file is run directly
if (require.main === module) {
    startServer().catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}