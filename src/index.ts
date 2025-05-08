import { Telegraf, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import process from 'process';
import { startServer } from './server';
import * as cron from 'node-cron';

dotenv.config();

// Environment variables
const requiredEnvVars = ['BOT_TOKEN'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} is missing from .env file`);
  }
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN!);
console.log('Bot initialized');

// Store tracked NFTs and user alerts
interface TrackedNFT {
  mintAddress: string;
  chatId: number;
  name: string;
  lastPrice?: number;
  alertPrice?: number;
  collection?: string;
}

const trackedNFTs: TrackedNFT[] = [];

// Collection tracking interface
interface CollectionActivity {
  symbol: string;
  name?: string;
  marketplace_url?: string;
  floorPrice?: number;
  lastSale?: {
    price: number;
    timestamp: number;
    tokenMint: string;
  };
  volume24h: number;
  listedCount: number;
}

const trackedCollections: { [key: string]: CollectionActivity } = {};

// Helper function to format price in SOL
const formatPrice = (lamports: number) => {
  return (lamports / 1e9).toFixed(2) + ' SOL';
};

// Collection addresses
const COLLECTIONS = {
  TRENCH_DEMONS: {
    symbol: 'trench_demons',
    name: 'Trench Demons',
    marketplace_url: 'https://magiceden.us/marketplace/trench_demons',
    mint: 'DPduL1SWjhjpUxcNUBQsbHiJfeMr8ayJki8vGnfuN1Gj'
  }
} as const;

// Add Magic Eden API helper
async function getMagicEdenCollectionInfo(symbol: string) {
  try {
    const response = await retryFetch(`https://api-mainnet.magiceden.dev/v2/collections/${symbol}/stats`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching from Magic Eden:', error);
    return null;
  }
}

// Update getAssetsByGroup to use only Magic Eden API
async function getAssetsByGroup(symbol: string, collectionAddress: string) {
  try {
    // Get collection info from Magic Eden
    const meInfo = await getMagicEdenCollectionInfo(symbol);

    if (!meInfo) {
      throw new Error('Could not fetch collection info');
    }

    // Get recent sales from Magic Eden
    const response = await retryFetch(
      `https://api-mainnet.magiceden.dev/v2/collections/${symbol}/activities?offset=0&limit=2&type=buyNow`,
      {},
      4,
      2000
    );

    const data = await response.json();
    return {
      assets: data || [],
      stats: meInfo
    };
  } catch (error) {
    console.error('Error fetching collection data:', error);
    return { assets: [], stats: null };
  }
}

// Update trench command
bot.command('trench', async (ctx) => {
  try {
    await ctx.reply('🔄 Fetching Trench Demons collection data...');

    const collection = COLLECTIONS.TRENCH_DEMONS;
    const { assets, stats } = await getAssetsByGroup(collection.symbol, collection.mint);

    if (!stats) {
      return ctx.reply('❌ Could not fetch Trench Demons collection info.');
    }

    // Add collection to tracking
    trackedCollections[collection.symbol] = {
      symbol: collection.symbol,
      name: collection.name,
      marketplace_url: collection.marketplace_url,
      floorPrice: stats.floorPrice || 0,
      volume24h: stats.volumeAll || 0,
      listedCount: stats.listedCount || 0,
      lastSale: assets[0] ? {
        price: assets[0].price || 0,
        timestamp: assets[0].timestamp || Date.now(),
        tokenMint: assets[0].mint || ''
      } : undefined
    };

    // Send collection info with marketplace link
    await ctx.reply(
      `✅ <b>Now tracking ${collection.name}</b>\n\n` +
      `Floor Price: ${((stats.floorPrice || 0) / 1e9).toFixed(3)} SOL\n` +
      `Listed Count: ${stats.listedCount || 0}\n` +
      `24h Volume: ${((stats.volumeAll || 0) / 1e9).toFixed(2)} SOL\n\n` +
      `🔗 <a href="${collection.marketplace_url}">View on Magic Eden</a>\n\n` +
      `Use /floor ${collection.symbol} to check latest stats`,
      {
        parse_mode: 'HTML',
      }
    );

  } catch (error: any) {
    console.error('Error in trench command:', error);
    ctx.reply('❌ Failed to track Trench Demons. Please try again later.');
  }
});

// Update trackCollectionActivity to use only Magic Eden API
async function trackCollectionActivity(collectionSymbol: string, collectionAddress: string) {
  try {
    const { assets, stats } = await getAssetsByGroup(collectionSymbol, collectionAddress);

    if (assets.length === 0) {
      return;
    }

    // Update collection activity with available data
    trackedCollections[collectionSymbol] = {
      symbol: collectionSymbol,
      floorPrice: stats?.floorPrice || 0,
      volume24h: stats?.volumeAll || 0,
      listedCount: stats?.listedCount || 0,
      lastSale: assets[0] ? {
        price: assets[0].price || 0,
        timestamp: new Date(assets[0].createdAt).getTime() || Date.now(),
        tokenMint: assets[0].tokenMint || ''
      } : undefined
    };

    // Notify users about the update
    for (const chatId of getCollectionSubscribers(collectionSymbol)) {
      bot.telegram.sendMessage(chatId,
        `📊 *${collectionSymbol} Update*\n` +
        `Listed Count: ${assets.length}\n` +
        `Last Updated: ${formatDate(new Date())}\n`,
        { parse_mode: 'Markdown' }
      );
    }

  } catch (error) {
    console.error(`Error tracking collection ${collectionSymbol}:`, error);
  }
}

// Helper function to get collection subscribers
function getCollectionSubscribers(collectionSymbol: string): number[] {
  return trackedNFTs
    .filter(nft => nft.collection === collectionSymbol)
    .map(nft => nft.chatId);
}

// Modify the track command to use Magic Eden API
bot.command('track', async (ctx) => {
  const mintAddress = ctx.message.text.split(' ')[1];

  if (!mintAddress) {
    return ctx.reply('Please provide an NFT mint address. Example: /track D3XrkNZz6wx6cofot7Zohsf2KSZ2Er8M6Ya8DkE3eG9U');
  }

  try {
    // Check if already tracked
    if (trackedNFTs.some(nft => nft.mintAddress === mintAddress && nft.chatId === ctx.chat!.id)) {
      return ctx.reply('This NFT is already being tracked!');
    }

    // Get NFT details from Magic Eden
    const response = await retryFetch(
      `https://api-mainnet.magiceden.dev/v2/tokens/${mintAddress}`,
      {},
      3,
      1000
    );

    if (!response.ok) {
      throw new Error('Failed to fetch NFT details');
    }

    const nftData = await response.json();

    // Add to tracking
    trackedNFTs.push({
      mintAddress,
      chatId: ctx.chat!.id,
      name: nftData.name || 'Unnamed NFT',
      collection: nftData.collection || undefined
    });

    // Create detailed caption for image with HTML formatting
    const caption = `✅ <b>Now tracking NFT</b>\n\n` +
      `<b>Name:</b> ${nftData.name}\n` +
      `<b>Mint:</b> ${mintAddress.slice(0, 6)}...${mintAddress.slice(-4)}` +
      (nftData.collection ? `\n<b>Collection:</b> ${nftData.collection}` : '');

    // Create buttons for alert setting and viewing collection
    const buttons = [];

    // Add alert button
    buttons.push([{
      text: '⏰ Set price alert',
      callback_data: `alert_${mintAddress}`
    }]);

    // Add collection button if available
    if (nftData.collection) {
      buttons.push([{
        text: '🔍 View on Magic Eden',
        url: `https://magiceden.io/items/${nftData.collection}`
      }]);
    }

    // Send confirmation with image and caption
    if (nftData.image) {
      // Send NFT image with all details in caption
      const imageSuccess = await safelySendImage(ctx, nftData.image, caption, "NFT image unavailable", buttons);

      // Only send text message if image sending failed
      if (!imageSuccess) {
        await ctx.reply(caption, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons }
        });
      }
    } else {
      // No image available, just send text
      await ctx.reply(caption, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      });
    }
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

// Update list command to use Magic Eden API
bot.command('list', async (ctx) => {
  const userNFTs = trackedNFTs.filter(nft => nft.chatId === ctx.chat!.id);

  if (userNFTs.length === 0) {
    return ctx.reply('You are not tracking any NFTs yet. Use /track [mint_address] to start.');
  }

  let message = '📋 *Your Tracked NFTs*\n\n';

  for (const nft of userNFTs) {
    try {
      const response = await retryFetch(
        `https://api-mainnet.magiceden.dev/v2/tokens/${nft.mintAddress}`,
        {},
        2,
        800
      );

      if (response.ok) {
        const nftData = await response.json();
        message += `🔹 *${nftData.name}*\n` +
          `Mint: ${nft.mintAddress.slice(0, 6)}...${nft.mintAddress.slice(-4)}\n` +
          `Collection: ${nftData.collection || 'N/A'}\n`;
        if (nft.alertPrice) {
          message += `Alert: ${nft.alertPrice} SOL\n`;
        }
        message += '\n';
      } else {
        message += `🔹 ${nft.mintAddress} (Error fetching data)\n\n`;
      }
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
        // Get NFT data from Magic Eden
        const response = await retryFetch(
          `https://api-mainnet.magiceden.dev/v2/tokens/${nft.mintAddress}`,
          {},
          2,
          800
        );

        if (!response.ok) {
          continue;
        }

        const nftData = await response.json();
        const currentPrice = nftData.price || 0;

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

// Add periodic collection tracking
setInterval(async () => {
  for (const [symbol, collection] of Object.entries(trackedCollections)) {
    await trackCollectionActivity(symbol, symbol);
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Add collection-specific commands
bot.command('collection', async (ctx) => {
  const collectionAddress = ctx.message.text.split(' ')[1];

  if (!collectionAddress) {
    return ctx.reply('Please provide a collection address. Example: /collection DPduL1SWjhjpUxcNUBQsbHiJfeMr8ayJki8vGnfuN1Gj');
  }

  try {
    await trackCollectionActivity(collectionAddress, collectionAddress);
    ctx.reply('✅ Now tracking collection. You will receive updates about floor price, listings, and sales.');
  } catch (error) {
    ctx.reply('❌ Failed to track collection. Please check the address and try again.');
  }
});

bot.command('floor', async (ctx) => {
  const collectionAddress = ctx.message.text.split(' ')[1];

  if (!collectionAddress) {
    // Show floor price for all tracked collections
    const floorInfo = Object.entries(trackedCollections)
      .map(([symbol, data]) =>
        `${data.name || symbol}:\n` +
        `Floor: ${((data.floorPrice || 0) / 1e9).toFixed(3)} SOL\n` +
        `Listed: ${data.listedCount}\n` +
        `${data.marketplace_url ? `🔗 <a href="${data.marketplace_url}">View on Magic Eden</a>` : ''}`
      )
      .join('\n\n');

    return ctx.reply(
      `<b>Floor Prices</b>\n\n${floorInfo || 'No collections tracked.'}`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  const collection = trackedCollections[collectionAddress];
  if (!collection) {
    return ctx.reply('Collection not tracked. Use /collection command first.');
  }

  ctx.reply(
    `<b>${collection.name || collection.symbol} Stats</b>\n\n` +
    `Floor Price: ${((collection.floorPrice || 0) / 1e9).toFixed(3)} SOL\n` +
    `Listed Count: ${collection.listedCount}\n` +
    `24h Volume: ${((collection.volume24h || 0) / 1e9).toFixed(2)} SOL\n` +
    `${collection.lastSale ?
      `Last Sale: ${(collection.lastSale.price / 1e9).toFixed(3)} SOL (${formatDate(collection.lastSale.timestamp)})`
      : ''}\n\n` +
    `${collection.marketplace_url ? `🔗 <a href="${collection.marketplace_url}">View on Magic Eden</a>` : ''}`,
    {
      parse_mode: 'HTML',
    }
  );
});

// Add a logger function
function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

// Add a human-readable date formatter
function formatDate(timestamp: number | string | Date): string {
  const date = new Date(timestamp);

  // Format: "May 15, 2023 at 14:30"
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }) + ' at ' +
    date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
}

// Add a timeout wrapper function
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeout: NodeJS.Timeout;
  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timeout after ${timeoutMs}ms: ${errorMessage}`));
        }, timeoutMs);
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timeout!);
  }
}

// Add a retry function for API calls
async function retryFetch(url: string, options: RequestInit = {}, maxRetries = 3, delay = 1000): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`Fetch attempt ${attempt}/${maxRetries}: ${url.substring(0, 70)}...`);
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP error ${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log(`Fetch attempt ${attempt} failed: ${lastError.message}`);
    }

    if (attempt < maxRetries) {
      // Wait before next retry, with exponential backoff
      const waitTime = delay * Math.pow(1.5, attempt - 1);
      log(`Waiting ${waitTime}ms before next retry`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw lastError || new Error('Maximum retries reached');
}

// Add a helper function for safe image sending
async function safelySendImage(ctx: any, imageUrl: string, captionText: string, fallbackMessage: string, inlineButtons?: any[][]): Promise<boolean> {
  try {
    log(`Attempting to send image with caption: ${imageUrl.substring(0, 50)}...`);

    // 1. Try sending as photo with caption
    try {
      if (typeof ctx === 'function') {
        // Direct telegram send
        await withTimeout(
          ctx(
            { url: imageUrl },
            {
              caption: captionText,
              parse_mode: 'HTML',
              reply_markup: inlineButtons ? { inline_keyboard: inlineButtons } : undefined
            }
          ),
          15000,
          'Image send timed out'
        );
      } else {
        // Context object send
        await withTimeout(
          ctx.replyWithPhoto(
            { url: imageUrl },
            {
              caption: captionText,
              parse_mode: 'HTML',
              reply_markup: inlineButtons ? { inline_keyboard: inlineButtons } : undefined
            }
          ),
          15000,
          'Image send timed out'
        );
      }
      log('Image with caption sent successfully');
      return true;
    } catch (error) {
      log('Primary image send failed, trying alternative method', error);

      // 2. Try with a different approach - send preview using a direct link with caption
      try {
        const previewText = `<a href="${imageUrl}">🖼</a> ${captionText}`;
        if (typeof ctx === 'function') {
          await withTimeout(
            ctx(previewText, {
              parse_mode: 'HTML',
              disable_web_page_preview: false,
              reply_markup: inlineButtons ? { inline_keyboard: inlineButtons } : undefined
            }),
            10000,
            'Image URL send timed out'
          );
        } else {
          await withTimeout(
            ctx.reply(previewText, {
              parse_mode: 'HTML',
              disable_web_page_preview: false,
              reply_markup: inlineButtons ? { inline_keyboard: inlineButtons } : undefined
            }),
            10000,
            'Image URL send timed out'
          );
        }
        log('Image URL with caption sent successfully');
        return true;
      } catch (secondError) {
        log('All image sending methods failed', secondError);

        // 3. Send text fallback
        if (typeof ctx === 'function') {
          await ctx(fallbackMessage || captionText, {
            reply_markup: inlineButtons ? { inline_keyboard: inlineButtons } : undefined
          });
        } else {
          await ctx.reply(fallbackMessage || captionText, {
            reply_markup: inlineButtons ? { inline_keyboard: inlineButtons } : undefined
          });
        }
        return false;
      }
    }
  } catch (e) {
    log('Fatal error in image sending', e);
    return false;
  }
}

const lastBuy = async (collectionSymbol: string, limit: number, ctx: any) => {
  try {
    const response = await retryFetch(
      `https://api-mainnet.magiceden.dev/v2/collections/${collectionSymbol}/activities?offset=0&limit=${limit}&type=buyNow`,
      {},
      3,
      1000
    );

    log(`API response status: ${response.status}`);

    log('Parsing API response');
    const activities = await response.json();
    
    // Add detailed logging of activities
    log(`Raw activities received: ${activities?.length || 0}`);
    if (activities && Array.isArray(activities)) {
      activities.forEach((activity, index) => {
        log(`Activity ${index + 1}:`, {
          blockTime: activity.blockTime,
          price: activity.price,
          tokenMint: activity.tokenMint?.substring(0, 8) + '...'
        });
      });
    }

    if (!activities || !Array.isArray(activities)) {
      log('Invalid response format', activities);
      throw new Error('Invalid response format from Magic Eden API');
    }

    // Filter activities to only include buys from the last 1 minute
    const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
    const oneMinuteAgo = currentTime - 60; // 1 minute = 60 seconds
    const recentActivities = activities.filter(activity =>
      activity.blockTime && activity.blockTime >= oneMinuteAgo
    );

    log(`Filtered to ${recentActivities.length} activities from the last 1 minute`);
    if (recentActivities.length > 0) {
      recentActivities.forEach((activity, index) => {
        log(`Recent Activity ${index + 1}:`, {
          blockTime: activity.blockTime,
          price: activity.price,
          tokenMint: activity.tokenMint?.substring(0, 8) + '...'
        });
      });
    }

    if (recentActivities.length === 0) {
      log('No activities found in the last 1 minute');
      return;
    }

    // Send a summary message first
    log(`Found ${recentActivities.length} recent activities, sending details`);

    // Process each sale with a timeout to avoid getting stuck
    let processedCount = 0;
    for (const sale of recentActivities.slice(0, limit)) {
      try {
        log(`Processing sale ${processedCount + 1}/${Math.min(limit, recentActivities.length)}`, {
          tokenMint: sale.tokenMint,
          price: sale.price,
          buyer: sale.buyer?.substring(0, 10) + '...',
          timestamp: sale.blockTime
        });

        // Get NFT details from Magic Eden with improved reliability
        let nftName = `${collectionSymbol} #${sale.tokenMint?.substring(0, 6)}`;
        let imageUrl = '';

        try {
          const nftDetailsResponse = await retryFetch(
            `https://api-mainnet.magiceden.dev/v2/tokens/${sale.tokenMint}`,
            {},
            2,  // Fewer retries for NFT details
            800  // Shorter delay
          );

          if (nftDetailsResponse.ok) {
            const nftDetails = await nftDetailsResponse.json();
            if (nftDetails && nftDetails.name) {
              nftName = nftDetails.name;
              imageUrl = nftDetails.image || '';
            }
          }
        } catch (detailsError) {
          log(`Could not fetch NFT details: ${detailsError instanceof Error ? detailsError.message : String(detailsError)}`, detailsError);
          // Continue with the default values set above
        }

        // Format NFT info with minimal info
        const price = (sale.price || 0);
        const buyerAddress = sale.buyer || 'Unknown';

        // Format buyer address for readability
        const formatAddress = (address: string) => {
          return address.length > 10 ?
            `${address.substring(0, 6)}...${address.substring(address.length - 4)}` :
            address;
        };

        // Create a caption for the image with all details and links
        const caption = `🌟 <b>New Sale Alert!</b> #${collectionSymbol}\n` +
          `━━━━━━━━━━━━━━━\n` +
          `🖼 <b>${nftName}</b>\n\n` +
          `💎 <b>Price:</b> ${price.toFixed(3)} SOL\n` +
          `👤 <b>Buyer:</b> <a href="https://solscan.io/account/${buyerAddress}">${formatAddress(buyerAddress)}</a>\n` +
          `\n#NFT #Solana #${collectionSymbol.replace(/_/g, '')}`;

        log('Generated message text:', {
          caption,
          nftName,
          price,
          buyerAddress
        });

        // Create inline keyboard buttons for marketplaces
        const inlineButtons = [
          [
            { text: '🏪 View on Magic Eden', url: `https://magiceden.io/item-details/${sale.tokenMint}` },
            { text: '📊 View on Tensor', url: `https://tensor.trade/item/${sale.tokenMint}` }
          ]
        ];

        // Create a fallback message without HTML for error cases
        const fallbackMessage = `New Sale Alert!\n${nftName}\n${price.toFixed(3)} SOL\nBuyer: ${formatAddress(buyerAddress)}`;

        log('Generated fallback message:', fallbackMessage);

        // Send message and image with caption
        log('Sending sale info');
        try {
          if (imageUrl) {
            // Send image with caption containing all details and inline buttons
            await safelySendImage(ctx, imageUrl, caption, fallbackMessage, inlineButtons);
          } else {
            // Send text message if no image available
            log('No image available, sending text message');
            await ctx.reply(fallbackMessage, {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: inlineButtons }
            });
          }
          log('Message sent successfully');
        } catch (messageError) {
          log('Error sending sale message', messageError);
        }

        // Add a small delay between messages to prevent rate limiting
        log('Adding delay between messages');
        await new Promise(resolve => setTimeout(resolve, 300));
        log('Delay completed');

        processedCount++;
      } catch (error) {
        log('Error processing sale', error);
        console.error('Error processing sale:', error);
        // Continue with next sale
      }
    }

    // Send completion message only if there were multiple images, which is unnecessary
    log(`Completed processing ${processedCount} sales`);

  } catch (error) {
    log('Error in lastbuy command', error);
    console.error('Error in lastbuy command:', error);
    try {
      await ctx.reply('❌ Failed to fetch recent sales. Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } catch (replyError) {
      log('Failed to send error message', replyError);
    }
  }
}

// Update lastbuy command
bot.command('lastbuy', async (ctx) => {
  try {
    log('Starting lastbuy command');
    const collectionSymbol = ctx.message.text.split(' ')[1] || 'trench_demons';
    const limit = 1; // Limit to 1 sale

    log(`Fetching sales for collection: ${collectionSymbol}, limit: ${limit}`);

    try {
      await withTimeout(
        ctx.reply(`🔍 Finding the latest NFT sales for ${collectionSymbol}...`),
        5000,
        'Initial reply timed out'
      );
    } catch (replyError) {
      log('Warning: Initial reply timed out, continuing anyway', replyError);
    }

    // Use Magic Eden API for recent activities
    log('Making API request to Magic Eden');
    lastBuy(collectionSymbol, limit, ctx);

  } catch (error) {
    log('Error in lastbuy command', error);
    console.error('Error in lastbuy command:', error);
    try {
      await ctx.reply('❌ Failed to fetch recent sales. Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } catch (replyError) {
      log('Failed to send error message', replyError);
    }
  }
});

// Add callback handler for the alert button
bot.action(/alert_(.+)/, async (ctx) => {
  try {
    const mintAddress = ctx.match[1];

    // Reply with instructions on how to set alert
    await ctx.reply(
      `To set a price alert for this NFT, please use the command:\n\n` +
      `/alert ${mintAddress} [price_in_sol]\n\n` +
      `Example: /alert ${mintAddress} 2.5`
    );

    // Answer the callback query to remove loading state
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Error handling alert callback:', error);
    ctx.answerCbQuery('Error processing request');
  }
});

// Launch bot
bot.launch()
  .then(() => {
    console.log('Bot started successfully');
    // Start the server after bot is launched
    startServer();
  })
  .catch((err) => {
    console.error('Failed to start bot:', err);
    process.exit(1);
  });

// Update cron schedule to run every minute
cron.schedule('* * * * *', async () => {
  try {
    const chatId = -1002611869947;
    log(`[Cron] Running scheduled check for new buys`);
    await lastBuy('trench_demons', 5, bot.telegram.sendPhoto.bind(bot.telegram, chatId));
  } catch (error) {
    log('[Cron] Error in scheduled execution:', error);
  }
});

// Enable graceful stop
process.once('SIGINT', () => {
  log('Stopping bot and cron jobs...');
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  log('Stopping bot and cron jobs...');
  bot.stop('SIGTERM');
  process.exit(0);
});

export { bot };
