import express from 'express';
import path from 'path';
import { bot } from './index';
import fetch from 'node-fetch';
import * as cron from 'node-cron';

const app = express();
// Use process.env.PORT for Render.com, fallback to 10000 for local development
const port = process.env.PORT ? parseInt(process.env.PORT) : 10000;
const host = '0.0.0.0'; // Listen on all network interfaces

// Add basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// Add a last activity timestamp
let lastActivity = Date.now();

// Self-ping function
async function selfPing() {
    try {
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
        const response = await fetch(`${baseUrl}/ping`);
        if (!response.ok) {
            console.error('Self-ping failed:', await response.text());
        } else {
            console.log('Self-ping successful');
        }
    } catch (error) {
        console.error('Self-ping error:', error);
    }
}

// Start self-ping cron job (every 13 minutes)
let selfPingCron: cron.ScheduledTask | null = null;

function startSelfPingCron() {
    if (selfPingCron) {
        selfPingCron.stop();
    }

    selfPingCron = cron.schedule('*/13 * * * *', async () => {
        console.log('Running self-ping cron job');
        await selfPing();
    });

    // Trigger initial self-ping
    selfPing();
}

// Update health check endpoint
app.get('/health', (_req, res) => {
    lastActivity = Date.now();
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    res.status(200).json({
        status: 'ok',
        bot: bot.telegram ? 'connected' : 'disconnected',
        port: port,
        environment: process.env.NODE_ENV || 'development',
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: {
            heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
            rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`
        },
        lastActivity: new Date(lastActivity).toISOString()
    });
});

// Add a ping endpoint for keep-alive
app.get('/ping', (_req, res) => {
    lastActivity = Date.now();
    res.status(200).send('pong');
});

// Add a monitor endpoint that returns 200 if the service is healthy
app.get('/monitor', (_req, res) => {
    const inactiveTime = Date.now() - lastActivity;
    if (inactiveTime > 30 * 60 * 1000) { // 30 minutes
        res.status(503).json({ status: 'error', message: 'Service inactive' });
    } else {
        res.status(200).json({ status: 'ok', lastActivity: new Date(lastActivity).toISOString() });
    }
});

// Add a wake-up endpoint
app.get('/wake', (_req, res) => {
    lastActivity = Date.now();
    selfPing(); // Trigger an immediate self-ping
    res.status(200).json({ status: 'ok', message: 'Wake-up signal sent' });
});

export function startServer() {
    return new Promise((resolve, reject) => {
        try {
            const server = app.listen(port, host, () => {
                console.log(`Server running on http://${host}:${port}`);
                console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

                // Start the self-ping cron job
                startSelfPingCron();

                resolve(server);
            });

            // Handle server errors
            server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`Port ${port} is already in use`);
                } else {
                    console.error('Server error:', err);
                }
                reject(err);
            });

            // Handle graceful shutdown
            const shutdown = () => {
                console.log('Received shutdown signal. Starting graceful shutdown...');
                if (selfPingCron) {
                    selfPingCron.stop();
                }
                server.close(() => {
                    console.log('Server closed');
                    process.exit(0);
                });
            };

            process.on('SIGTERM', shutdown);
            process.on('SIGINT', shutdown);

        } catch (err) {
            console.error('Failed to start server:', err);
            reject(err);
        }
    });
}

// Only start the server if this file is run directly
if (require.main === module) {
    startServer().catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}