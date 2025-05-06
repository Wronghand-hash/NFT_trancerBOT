# NFT Tracking Bot for Telegram

A Telegram bot that helps you track Solana NFTs and get price alerts.

## Features

- Track NFTs by mint address
- Get real-time price updates
- Set price alerts
- View tracked NFTs in a list
- Get NFT details including image and collection info

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   cp .env.example .env
   ```
4. Get a Telegram bot token from [@BotFather](https://t.me/botfather)
5. Get a Solana RPC URL (you can use a public one or get a dedicated one from services like [QuickNode](https://www.quicknode.com/))
6. Build and run the bot:
   ```
   npm run build
   npm start
   ```

## Available Commands

- `/start` - Show welcome message
- `/help` - Show available commands
- `/track [mint_address]` - Start tracking an NFT
- `/untrack [mint_address]` - Stop tracking an NFT
- `/list` - Show all tracked NFTs
- `/alert [mint_address] [price_in_sol]` - Set price alert for an NFT

## Example

1. Track an NFT:
   ```
   /track D3XrkNZz6wx6cofot7Zohsf2KSZ2Er8M6Ya8DkE3eG9U
   ```

2. Set a price alert:
   ```
   /alert D3XrkNZz6wx6cofot7Zohsf2KSZ2Er8M6Ya8DkE3eG9U 5.5
   ```

## Notes

- The bot checks for price changes every 30 seconds
- Price alerts are triggered when the NFT's price drops to or below your specified price
- The bot only tracks NFTs on the Solana blockchain

## License

MIT
