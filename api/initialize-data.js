// api/initialize-data.js
// Mock data version - uses fake data to test the system
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Mock stock data
    const stocksData = {
      'AAPL': { name: 'Apple Inc.', currentPrice: 195.50, targetPrice: 220.00 },
      'MSFT': { name: 'Microsoft Corporation', currentPrice: 378.25, targetPrice: 410.00 },
      'GOOGL': { name: 'Alphabet Inc.', currentPrice: 140.35, targetPrice: 165.00 },
      'AMZN': { name: 'Amazon.com Inc.', currentPrice: 151.20, targetPrice: 175.00 },
      'META': { name: 'Meta Platforms Inc.', currentPrice: 352.90, targetPrice: 395.00 }
    };

    const allSymbols = Object.keys(stocksData);
    const results = {
      totalSymbols: allSymbols.length,
      processed: 0,
      successCount: 0,
      failCount: 0,
      details: []
    };

    const today = new Date();

    for (const symbol of allSymbols) {
      try {
        const stock = stocksData[symbol];
        let pricesInserted = 0;
        
        // Generate 30 days of mock price data
        const prices = [];
        const basePrice = stock.currentPrice;
        
        for (let i = 29; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          
          // Add some random variation
          const variation = (Math.random() - 0.5) * 10;
          const price = basePrice + variation;
          
          prices.push({
            symbol: symbol,
            date: date.toISOString().split('T')[0],
            open: price + (Math.random() - 0.5) * 2,
            high: price + Math.random() * 3,
            low: price - Math.random() * 3,
            close: price,
            volume: Math.floor(Math.random() * 100000000)
          });
        }

        // Insert price data
        const { error: priceError } = await supabase
          .from('stock_prices')
          .upsert(prices, { 
            onConflict: 'symbol,date',
            ignoreDuplicates: false 
          });

        if (!priceError) {
          pricesInserted = prices.length;
        }

        // Insert analyst data
        const analystRecord = {
          symbol: symbol,
          date: today.toISOString().split('T')[0],
          target_mean: stock.targetPrice,
          target_high: stock.targetPrice * 1.1,
          target_low: stock.targetPrice * 0.9,
          recommendation: 'buy',
          number_of_analysts: 25
        };

        const { error: analystError } = await supabase
          .from('analyst_data')
          .upsert([analystRecord], { 
            onConflict: 'symbol,date',
            ignoreDuplicates: false 
          });

        const analystInserted = !analystError;

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
      message: 'Mock data initialization completed',
      results: results,
      note: 'Using mock data - replace with real API later',
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