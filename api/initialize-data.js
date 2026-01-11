// api/initialize-data.js - One-time historical data collection
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
    console.log('Starting data initialization...');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

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
      errors: []
    };

    for (const symbol of symbols) {
      try {
        console.log(`Processing ${symbol}...`);
        results.processed++;

        // Get 90 days of historical data
        const endDate = Math.floor(Date.now() / 1000);
        const startDate = endDate - (90 * 24 * 60 * 60);

        const historyResponse = await fetch(
          `https://${RAPIDAPI_HOST}/api/v2/stock/history?symbol=${symbol}&interval=1d&diffandsplits=false`,
          {
            headers: {
              'X-RapidAPI-Key': RAPIDAPI_KEY,
              'X-RapidAPI-Host': RAPIDAPI_HOST
            }
          }
        );

        if (!historyResponse.ok) {
          throw new Error(`Failed to fetch history for ${symbol}`);
        }

        const historyData = await historyResponse.json();
        const items = historyData.body?.items || {};

        // Convert to array and sort by date
        const priceData = Object.values(items)
          .sort((a, b) => a.date_utc - b.date_utc)
          .slice(-90) // Last 90 days
          .map(item => ({
            symbol: symbol,
            date: item.date,
            date_utc: item.date_utc,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume
          }));

        if (priceData.length > 0) {
          // Insert price data into Supabase
          const { error: priceError } = await supabase
            .from('stock_prices')
            .upsert(priceData, {
              onConflict: 'symbol,date'
            });

          if (priceError) {
            throw new Error(`Database error for ${symbol}: ${priceError.message}`);
          }

          console.log(`✓ Stored ${priceData.length} days for ${symbol}`);
          results.successful++;
        } else {
          console.log(`⚠ No data found for ${symbol}`);
          results.failed++;
        }

        // Rate limiting - wait 200ms between requests
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`Error processing ${symbol}:`, error);
        results.failed++;
        results.errors.push({ symbol, error: error.message });
      }
    }

    console.log('Initialization complete:', results);

    return res.status(200).json({
      success: true,
      message: 'Historical data initialization complete',
      results: results
    });

  } catch (error) {
    console.error('Initialization error:', error);
    return res.status(500).json({ 
      error: 'Initialization failed', 
      message: error.message 
    });
  }
}
