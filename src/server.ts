import express from 'express';

const app = express();
const port = Number(process.env.PORT) || 10000;

app.get('/', (_req: any, res: any) => res.send('Bot is running'));

export function startServer() {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
} 