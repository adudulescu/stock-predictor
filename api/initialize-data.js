// api/initialize-data.js
// Standalone version - collects data directly without calling other APIs
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
    
    if (!RAPIDAPI_KEY) {
      return res.status(500).json({ error: 'RAPIDAPI_KEY not configured' });
    }

    // List of stocks to initialize
    const allSymbols = [
      'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA',
      'UNH', 'XOM', 'JPM', 'JNJ', 'V', 'PG', 'MA', 'HD',
      'CVX', 'MRK', 'ABBV', 'LLY', 'AVGO'
    ];

    const results = {
      totalSymbols: allSymbols.length,
      processed: 0,
      successCount: 0,
      failCount: 0,
      details: []
    };

    // Process each symbol
    for (const symbol of allSymbols) {
      try {
        console.log(`Processing ${symbol}...`);

        // 1. Fetch historical prices (90 days)
        const priceUrl = `https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/v3/get-historical-data?symbol=${symbol}&region=US`;
        
        const priceResponse = await fetch(priceUrl, {
          method: 'GET',
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'apidojo-yahoo-finance-v1.p.rapidapi.com'
          }
        });

        let pricesInserted = 0;

        if (priceResponse.ok) {
          const priceText = await priceResponse.text();
          let priceData;
          try {
            priceData = JSON.parse(priceText);
          } catch (e) {
            console.error(`JSON parse error for ${symbol}:`, e.message);
            throw new Error(`Invalid JSON response for price data: ${priceText.substring(0, 100)}`);
          }
          
          if (priceData.prices && Array.isArray(priceData.prices)) {
            const pricesToInsert = priceData.prices
              .filter(p => p.date && p.close)
              .slice(0, 90)
              .map(p => ({
                symbol: symbol,
                date: new Date(p.date * 1000).toISOString().split('T')[0],
                open: p.open || null,
                high: p.high || null,
                low: p.low || null,
                close: p.close,
                volume: p.volume || null
              }));

            if (pricesToInsert.length > 0) {
              const { error: priceError } = await supabase
                .from('stock_prices')
                .upsert(pricesToInsert, { 
                  onConflict: 'symbol,date',
                  ignoreDuplicates: false 
                });

              if (!priceError) {
                pricesInserted = pricesToInsert.length;
              } else {
                console.error(`Price insert error for ${symbol}:`, priceError);
              }
            }
          }
        }

        // 2. Fetch current quote with analyst data
        const quoteUrl = `https://apidojo-yahoo-finance-v1.p.rapidapi.com/market/v2/get-quotes?region=US&symbols=${symbol}`;
        
        const quoteResponse = await fetch(quoteUrl, {
          method: 'GET',
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'apidojo-yahoo-finance-v1.p.rapidapi.com'
          }
        });

        let analystInserted = false;

        if (quoteResponse.ok) {
          const quoteText = await quoteResponse.text();
          let quoteData;
          try {
            quoteData = JSON.parse(quoteText);
          } catch (e) {
            console.error(`JSON parse error for quote ${symbol}:`, e.message);
            // Continue anyway, analyst data is optional
            quoteData = null;
          }
          
          if (quoteData) {
            const quote = quoteData.quoteResponse?.result?.[0];
          
          if (quote) {
            const analystRecord = {
              symbol: symbol,
              date: new Date().toISOString().split('T')[0],
              target_mean: quote.targetMeanPrice || null,
              target_high: quote.targetHighPrice || null,
              target_low: quote.targetLowPrice || null,
              recommendation: quote.recommendationKey || null,
              number_of_analysts: quote.numberOfAnalystOpinions || null
            };

            const { error: analystError } = await supabase
              .from('analyst_data')
              .upsert([analystRecord], { 
                onConflict: 'symbol,date',
                ignoreDuplicates: false 
              });

            if (!analystError) {
              analystInserted = true;
            }
          }
        }

        // Small delay to avoid rate limiting (increased to 500ms)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        results.processed++;
        if (pricesInserted > 0 || analystInserted) {
          results.successCount++;
        } else {
          results.failCount++;
        }

        results.details.push({
          symbol,
          pricesInserted,
          analystInserted,
          success: pricesInserted > 0 || analystInserted
        });

      } catch (error) {
        console.error(`Error processing ${symbol}:`, error);
        results.failCount++;
        results.details.push({
          symbol,
          error: error.message,
          success: false
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Data initialization completed',
      results: results,
      completedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Initialization error:', error);
    return res.status(500).json({ 
      error: 'Initialization failed', 
      message: error.message 
    });
  }
}