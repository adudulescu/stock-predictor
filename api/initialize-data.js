// api/initialize-data.js - Improved with better error handling and rate limiting
import { createClient } from '@supabase/supabase-js';

const RAPIDAPI_KEY = '58cacb4713mshe9e5eb3e89dad26p12c9d0jsn2113d69535c8';
const RAPIDAPI_HOST = 'yahoo-finance15.p.rapidapi.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[INIT] Starting data initialization...');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Check if we already have recent data
    const { data: existingData, error: checkError } = await supabase
      .from('stock_prices')
      .select('symbol, COUNT(*)')
      .gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

    if (!checkError && existingData && existingData.length > 15) {
      console.log('[INIT] Recent data already exists, skipping initialization');
      return res.status(200).json({
        success: true,
        message: 'Data already initialized recently',
        results: {
          processed: 0,
          successful: existingData.length,
          failed: 0,
          skipped: existingData.length,
          errors: []
        }
      });
    }

    // Top 20 S&P 500 stocks
    const symbols = [
      'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 
      'META', 'TSLA', 'BRK.B', 'UNH', 'XOM',
      'JPM', 'JNJ', 'V', 'PG', 'MA',
      'HD', 'CVX', 'MRK', 'ABBV', 'LLY'
    ];

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [],
      apiCalls: 0,
      rateLimits: 0
    };

    // Process in smaller batches to avoid rate limits
    const batchSize = 2; // Only 2 stocks at a time
    const delayBetweenBatches = 3000; // 3 seconds between batches
    const delayBetweenStocks = 1500; // 1.5 seconds between individual stocks

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      console.log(`[INIT] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(symbols.length / batchSize)}: ${batch.join(', ')}`);

      for (const symbol of batch) {
        try {
          console.log(`[${symbol}] Starting...`);
          results.processed++;

          // Check if data already exists for this symbol
          const { data: existingPrices } = await supabase
            .from('stock_prices')
            .select('date')
            .eq('symbol', symbol)
            .order('date', { ascending: false })
            .limit(1);

          if (existingPrices && existingPrices.length > 0) {
            const lastDate = new Date(existingPrices[0].date);
            const daysSinceUpdate = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            
            if (daysSinceUpdate < 2) {
              console.log(`[${symbol}] Data is recent (${daysSinceUpdate} days old), skipping`);
              results.successful++;
              continue;
            }
          }

          // Fetch historical data with retry logic
          results.apiCalls++;
          let historyResponse;
          let retryCount = 0;
          const maxRetries = 2;

          while (retryCount < maxRetries) {
            try {
              console.log(`[${symbol}] Fetching history (attempt ${retryCount + 1}/${maxRetries})...`);
              
              historyResponse = await fetch(
                `https://${RAPIDAPI_HOST}/api/v1/markets/stock/history?ticker=${symbol}&interval=1d`,
                {
                  headers: {
                    'X-RapidAPI-Key': RAPIDAPI_KEY,
                    'X-RapidAPI-Host': RAPIDAPI_HOST
                  }
                }
              );

              if (historyResponse.status === 429) {
                console.log(`[${symbol}] Rate limited (429), waiting...`);
                results.rateLimits++;
                retryCount++;
                if (retryCount < maxRetries) {
                  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                  continue;
                }
                throw new Error('Rate limited after retries');
              }

              if (!historyResponse.ok) {
                throw new Error(`HTTP ${historyResponse.status}: ${historyResponse.statusText}`);
              }

              break; // Success, exit retry loop

            } catch (fetchError) {
              retryCount++;
              if (retryCount >= maxRetries) {
                throw fetchError;
              }
              console.log(`[${symbol}] Fetch error, retrying...`, fetchError.message);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          const historyData = await historyResponse.json();
          
          // Handle different response formats
          let items = historyData.body?.items;
          let priceArray = [];

          if (Array.isArray(items)) {
            priceArray = items;
          } else if (items && typeof items === 'object') {
            // Convert object to array and sort by date
            priceArray = Object.values(items)
              .filter(item => item.date && item.close)
              .sort((a, b) => (a.date_utc || 0) - (b.date_utc || 0));
          }

          if (priceArray.length === 0) {
            throw new Error('No price data returned from API');
          }

          // Take last 90 days
          const last90Days = priceArray.slice(-90);

          // Prepare data for insertion
          const priceData = last90Days.map(item => ({
            symbol: symbol,
            date: item.date,
            date_utc: item.date_utc,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume
          }));

          // Insert into database
          const { error: insertError } = await supabase
            .from('stock_prices')
            .upsert(priceData, {
              onConflict: 'symbol,date',
              ignoreDuplicates: false
            });

          if (insertError) {
            throw new Error(`Database error: ${insertError.message}`);
          }

          console.log(`[${symbol}] ✓ Stored ${priceData.length} days successfully`);
          results.successful++;

          // Delay between stocks in the same batch
          if (batch.indexOf(symbol) < batch.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenStocks));
          }

        } catch (error) {
          console.error(`[${symbol}] ✗ Error:`, error.message);
          results.failed++;
          results.errors.push({ 
            symbol, 
            error: error.message,
            timestamp: new Date().toISOString()
          });

          // If this is a rate limit error, add extra delay
          if (error.message.includes('Rate limited') || error.message.includes('429')) {
            console.log(`[${symbol}] Adding extra delay due to rate limit...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }

      // Delay between batches
      if (i + batchSize < symbols.length) {
        console.log(`[INIT] Waiting ${delayBetweenBatches}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    // Log the initialization
    try {
      await supabase.from('api_usage_logs').insert([{
        timestamp: new Date().toISOString(),
        total_requests: results.apiCalls,
        successful_requests: results.successful,
        failed_requests: results.failed,
        rate_limit_hits: results.rateLimits,
        api_provider: 'yahoo-finance15'
      }]);
    } catch (logError) {
      console.log('[INIT] Failed to log usage:', logError.message);
    }

    console.log('[INIT] Initialization complete:', results);

    return res.status(200).json({
      success: true,
      message: 'Historical data initialization complete',
      results: results,
      summary: {
        totalSymbols: symbols.length,
        successful: results.successful,
        failed: results.failed,
        successRate: `${((results.successful / symbols.length) * 100).toFixed(1)}%`,
        apiCallsMade: results.apiCalls,
        rateLimitHits: results.rateLimits
      }
    });

  } catch (error) {
    console.error('[INIT] Fatal error:', error);
    return res.status(500).json({ 
      error: 'Initialization failed', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
