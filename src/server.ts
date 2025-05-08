import express from 'express';
import path from 'path';
import { bot } from './index';

const app = express();
const port = Number(process.env.PORT) || 10000;
const host = '0.0.0.0';

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (_req, res) => {
    const botStatus = bot.telegram ? '🟢 Running' : '🔴 Not Running';
    res.send(`<html>...</html>`); // Your existing HTML
});

export function startServer() {
    app.listen(port, host, () => {
        console.log(`Server running on http://${host}:${port}`);
    }).on('error', (err) => {
        console.error('Server startup error:', err);
    });
}

startServer();