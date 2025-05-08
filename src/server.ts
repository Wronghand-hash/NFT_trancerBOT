import express from 'express';
import path from 'path';
import { bot } from './index';

const app = express();
const port = Number(process.env.PORT) || 10000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Status page
app.get('/', (_req: any, res: any) => {
    const botStatus = bot.telegram ? '🟢 Running' : '🔴 Not Running';
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>NFT Tracker Bot Status</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                    line-height: 1.6;
                }
                .status {
                    color: #4CAF50;
                    font-weight: bold;
                }
                .status.error {
                    color: #f44336;
                }
                .commands {
                    background: #f5f5f5;
                    padding: 20px;
                    border-radius: 5px;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <h1>NFT Tracker Bot</h1>
            <p>Status: <span class="status ${bot.telegram ? '' : 'error'}">${botStatus}</span></p>
            <div class="commands">
                <h2>Available Commands:</h2>
                <ul>
                    <li>/trench - Track Trench Demons collection</li>
                    <li>/track [mint_address] - Track individual NFT</li>
                    <li>/floor [collection] - Check floor price</li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

export function startServer() {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
} 