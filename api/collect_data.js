// api/collect-data.js
// Collects historical stock data and stores in Supabase
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: 'Symbols array required' });
    }

    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
    
    if (!RAPIDAPI_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const results = {
      success: [],
      failed: [],
      totalPrices: 0,
      totalAnalyst: 0
    };

    for (const symbol of symbols) {
      try {
        // 1. Fetch historical prices (90 days)
        const priceUrl = `https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/v3/get-historical-data?symbol=${symbol}&region=US`;
        
        const priceResponse = await fetch(priceUrl, {
          method: 'GET',
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'apidojo-yahoo-finance-v1.p.rapidapi.com'
          }
        });

        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          
          // Store historical prices
          if (priceData.prices && Array.isArray(priceData.prices)) {
            const pricesToInsert = priceData.prices
              .filter(p => p.date && p.close) // Only valid entries
              .slice(0, 90) // Last 90 days
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
                results.totalPrices += pricesToInsert.length;
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

        if (quoteResponse.ok) {
          const quoteData = await quoteResponse.json();
          const quote = quoteData.quoteResponse?.result?.[0];
          
          if (quote) {
            // Store analyst data
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
              results.totalAnalyst += 1;
            }
          }
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
        results.success.push(symbol);

      } catch (error) {
        console.error(`Error processing ${symbol}:`, error);
        results.failed.push({ symbol, error: error.message });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Data collection completed',
      results: results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Data collection error:', error);
    return res.status(500).json({ 
      error: 'Data collection failed', 
      message: error.message 
    });
  }
}