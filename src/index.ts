import { Telegraf, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { Metaplex } from '@metaplex-foundation/js';
import process from 'process';

dotenv.config();

// Environment variables
const requiredEnvVars = ['BOT_TOKEN', 'RPC_URL'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} is missing from .env file`);
  }
}

// Initialize bot and Solana connection
const bot = new Telegraf(process.env.BOT_TOKEN!);
console.log('Connecting to Solana RPC:', process.env.RPC_URL);
const connection = new Connection(process.env.RPC_URL!, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 30000 // 30 seconds
});
const metaplex = new Metaplex(connection);
console.log('Metaplex initialized');

// Store tracked NFTs and user alerts
interface TrackedNFT {
  mintAddress: string;
  chatId: number;
  name: string;
  lastPrice?: number;
  alertPrice?: number;
}

const trackedNFTs: TrackedNFT[] = [];

// Helper function to format price in SOL
const formatPrice = (lamports: number) => {
  return (lamports / 1e9).toFixed(2) + ' SOL';
};

// Collection addresses
const COLLECTIONS = {
  TRENCH_DEMONS: 'trench_demons', // Collection symbol/identifier
  TRENCH_DEMONS_MINT: 'DPduL1SWjhjpUxcNUBQsbHiJfeMr8ayJki8vGnfuN1Gj' // Example NFT from the collection
} as const;

// Command handlers
bot.start((ctx) => {
  const welcomeMessage = `
🎨 *NFT Tracker Bot* 🖼️\n\n` +
    `I can help you track your favorite NFTs on Solana!\n\n` +
    `*Available commands:*\n` +
    `/track [mint_address] - Track an NFT\n` +
    `/untrack [mint_address] - Stop tracking an NFT\n` +
    `/list - Show all tracked NFTs\n` +
    `/alert [mint_address] [price_in_sol] - Set price alert\n`;
    
  ctx.replyWithMarkdown(welcomeMessage);
});

bot.command('help', (ctx) => {
  ctx.replyWithMarkdown(
    `*Available commands:*\n` +
    `/trench - Track Trench Demons collection\n` +
    `/track [mint_address] - Track any NFT\n` +
    `/untrack [mint_address] - Stop tracking an NFT\n` +
    `/list - Show all tracked NFTs\n` +
    `/alert [mint_address] [price_in_sol] - Set price alert`
  );
});

// Track Trench Demons collection
bot.command('trench', async (ctx) => {
  try {
    await ctx.reply('🔄 Fetching Trench Demons collection data...');
    
    // First, let's try to find NFTs from the collection
    const nfts = await metaplex.nfts().findAllByCreator({
      creator: new PublicKey('DPduL1SWjhjpUxcNUBQsbHiJfeMr8ayJki8vGnfuN1Gj')
    });
    
    if (nfts.length === 0) {
      return ctx.reply('❌ Could not find any NFTs from the Trench Demons collection.');
    }
    
    // Take the first NFT from the collection
    const nft = nfts[0];
    const mintAddress = nft.address.toBase58();
    
    // Check if already tracked
    if (trackedNFTs.some(nft => nft.mintAddress === mintAddress && nft.chatId === ctx.chat!.id)) {
      return ctx.reply('You are already tracking this Trench Demons NFT!');
    }
    
    // Get full NFT data
    const nftData = await metaplex.nfts().findByMint({ mintAddress: nft.address });
    
    // Add to tracking
    trackedNFTs.push({
      mintAddress,
      chatId: ctx.chat!.id,
      name: nftData.name || 'Unnamed NFT'
    });

    // Send confirmation with more details
    try {
      await ctx.replyWithPhoto(
        { url: nftData.json?.image || 'https://via.placeholder.com/400x400?text=No+Image' },
        {
          caption: `✅ *Now tracking Trench Demons NFT*\n` +
                  `Name: ${nftData.name || 'N/A'}\n` +
                  `Mint: ${mintAddress.slice(0, 6)}...${mintAddress.slice(-4)}\n` +
                  `Collection: ${nftData.json?.collection?.name || 'Trench Demons'}\n` +
                  `Use /alert ${mintAddress} [price] to set a price alert`,
          parse_mode: 'Markdown'
        }
      );
    } catch (sendError) {
      console.error('Error sending message:', sendError);
      // If photo fails, try sending text only
      await ctx.reply(
        `✅ Now tracking Trench Demons NFT\n` +
        `Name: ${nftData.name || 'N/A'}\n` +
        `Mint: ${mintAddress.slice(0, 6)}...${mintAddress.slice(-4)}`
      );
    }
  } catch (error: any) {
    console.error('Error in trench command:', error);
    ctx.reply(`❌ Failed to track Trench Demons collection. Error: ${error?.message || 'Unknown error'}`);
  }
});

bot.command('track', async (ctx) => {
  const mintAddress = ctx.message.text.split(' ')[1];
  
  if (!mintAddress) {
    return ctx.reply('Please provide an NFT mint address. Example: /track D3XrkNZz6wx6cofot7Zohsf2KSZ2Er8M6Ya8DkE3eG9U');
  }

  try {
    // Validate mint address
    new PublicKey(mintAddress);
    
    // Check if already tracked
    if (trackedNFTs.some(nft => nft.mintAddress === mintAddress && nft.chatId === ctx.chat!.id)) {
      return ctx.reply('This NFT is already being tracked!');
    }

    // Get NFT metadata
    const nft = await metaplex.nfts().findByMint({ mintAddress: new PublicKey(mintAddress) });
    
    // Add to tracking
    trackedNFTs.push({
      mintAddress,
      chatId: ctx.chat!.id,
      name: nft.name || 'Unnamed NFT'
    });

    // Send confirmation
    await ctx.replyWithPhoto(
      { url: nft.json?.image || '' },
      {
        caption: `✅ *Now tracking NFT*\n` +
                `Name: ${nft.name}\n` +
                `Mint: ${mintAddress}\n` +
                `Collection: ${nft.json?.collection?.name || 'N/A'}\n` +
                `Use /alert ${mintAddress} [price] to set a price alert`,
        parse_mode: 'Markdown'
      }
    );
  } catch (error) {
    console.error('Error tracking NFT:', error);
    ctx.reply('❌ Failed to track NFT. Please check the mint address and try again.');
  }
});

bot.command('untrack', (ctx) => {
  const mintAddress = ctx.message.text.split(' ')[1];
  
  if (!mintAddress) {
    return ctx.reply('Please provide an NFT mint address to untrack.');
  }

  const index = trackedNFTs.findIndex(nft => 
    nft.mintAddress === mintAddress && nft.chatId === ctx.chat!.id
  );

  if (index === -1) {
    return ctx.reply('This NFT is not being tracked.');
  }

  trackedNFTs.splice(index, 1);
  ctx.reply('✅ NFT is no longer being tracked.');
});

bot.command('list', async (ctx) => {
  const userNFTs = trackedNFTs.filter(nft => nft.chatId === ctx.chat!.id);
  
  if (userNFTs.length === 0) {
    return ctx.reply('You are not tracking any NFTs yet. Use /track [mint_address] to start.');
  }

  let message = '📋 *Your Tracked NFTs*\n\n';
  
  for (const nft of userNFTs) {
    try {
      const nftData = await metaplex.nfts().findByMint({ mintAddress: new PublicKey(nft.mintAddress) });
      message += `🔹 *${nftData.name}*\n` +
                `Mint: ${nft.mintAddress.slice(0, 6)}...${nft.mintAddress.slice(-4)}\n` +
                `Collection: ${nftData.json?.collection?.name || 'N/A'}\n`;
      if (nft.alertPrice) {
        message += `Alert: ${nft.alertPrice} SOL\n`;
      }
      message += '\n';
    } catch (error) {
      console.error('Error fetching NFT data:', error);
      message += `🔹 ${nft.mintAddress} (Error fetching data)\n\n`;
    }
  }

  ctx.replyWithMarkdown(message);
});

bot.command('alert', async (ctx) => {
  const [_, mintAddress, priceStr] = ctx.message.text.split(' ');
  const price = parseFloat(priceStr);
  
  if (!mintAddress || isNaN(price)) {
    return ctx.reply('Please provide a valid mint address and price. Example: /alert D3XrkNZz... 5.5');
  }

  const nftIndex = trackedNFTs.findIndex(nft => 
    nft.mintAddress === mintAddress && nft.chatId === ctx.chat!.id
  );

  if (nftIndex === -1) {
    return ctx.reply('You need to track this NFT first using /track command.');
  }

  trackedNFTs[nftIndex].alertPrice = price;
  ctx.reply(`✅ Price alert set for ${price} SOL. You'll be notified if the price drops to or below this value.`);
});

// Check for price changes periodically
setInterval(async () => {
  try {
    for (const nft of trackedNFTs) {
      try {
        // Get the NFT data first
        const nftData = await metaplex.nfts().findByMint({ mintAddress: new PublicKey(nft.mintAddress) });
        
        // Try to get the price from the auction house
        let currentPrice = 0;
        try {
          const auctionHouse = await metaplex.auctionHouse().findByAddress({
            address: new PublicKey('8Z1Q6jbPJEubzGqRyQKb5HVvpUey1fcLdLU8RfPZu6fM') // Default Metaplex Auction House
          });

          const listings = await metaplex.auctionHouse().findListings({ 
            auctionHouse,
            mint: new PublicKey(nft.mintAddress) 
          });

          if (listings.length > 0) {
            // Convert the price to lamports (1 SOL = 1,000,000,000 lamports)
            currentPrice = listings[0].price.basisPoints.toNumber();
          }
        } catch (error) {
          console.error('Error checking auction house:', error);
          // If auction house check fails, just continue with price = 0
        }
        
        // Check if price dropped below alert threshold
        if (nft.alertPrice && currentPrice > 0 && currentPrice <= nft.alertPrice * 1e9) {
          bot.telegram.sendMessage(
            nft.chatId,
            `🚨 *Price Alert*\n` +
            `NFT: ${nftData.name || 'Unnamed NFT'}\n` +
            `Current Price: ${formatPrice(currentPrice)}\n` +
            `Your Alert: ${nft.alertPrice} SOL\n\n` +
            `Mint: ${nft.mintAddress}`,
            { parse_mode: 'Markdown' }
          );
          
          // Remove alert after triggering
          nft.alertPrice = undefined;
        }
        
        // Update last price
        nft.lastPrice = currentPrice;
      } catch (error) {
        console.error('Error checking NFT price:', error);
      }
    }
  } catch (error) {
    console.error('Error in price check interval:', error);
  }
}, 30000); // Check every 30 seconds

// Start the bot
bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
