// api/predict.js - IMPROVED with aggressive caching and rate limiting
import { createClient } from '@supabase/supabase-js';

const RAPIDAPI_KEY = '58cacb4713mshe9e5eb3e89dad26p12c9d0jsn2113d69535c8';
const RAPIDAPI_HOST = 'yahoo-finance15.p.rapidapi.com';

// Cache TTL settings
const CACHE_TTL = {
  QUOTE: 5 * 60 * 1000,        // 5 minutes for real-time quotes
  HISTORY: 24 * 60 * 60 * 1000, // 24 hours for historical data
  PREDICTION: 4 * 60 * 60 * 1000 // 4 hours for predictions
};

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
    const { symbols, minUpside = 0 } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: 'Symbols array required' });
    }

    console.log(`[PREDICT] Starting analysis for ${symbols.length} symbols`);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // STEP 1: Check for cached predictions (< 4 hours old)
    const cacheTime = new Date(Date.now() - CACHE_TTL.PREDICTION).toISOString();
    const { data: cachedPredictions } = await supabase
      .from('predictions')
      .select('*')
      .in('symbol', symbols)
      .gte('created_at', cacheTime);

    const cachedSymbols = new Set(cachedPredictions?.map(p => p.symbol) || []);
    const symbolsToFetch = symbols.filter(s => !cachedSymbols.has(s));

    console.log(`[CACHE] Found ${cachedSymbols.size} cached, need ${symbolsToFetch.length} fresh`);

    const predictions = [];
    const apiStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0
    };

    // Add cached predictions
    if (cachedPredictions && cachedPredictions.length > 0) {
      cachedPredictions.forEach(p => {
        predictions.push({
          symbol: p.symbol,
          name: p.symbol,
          currentPrice: p.current_price,
          predictedPrice: p.predicted_price,
          predictedUpside: p.predicted_upside,
          confidence: p.confidence_score,
          technicalScore: p.technical_score,
          analystScore: p.analyst_score,
          sentimentScore: p.sentiment_score,
          combinedScore: (p.technical_score * 0.4 + p.analyst_score * 0.4 + p.sentiment_score * 0.2),
          technical: p.technical_data || {},
          signals: p.signals || [],
          cached: true
        });
      });
    }

    // STEP 2: Fetch only non-cached symbols with rate limiting
    if (symbolsToFetch.length > 0) {
      let processedCount = 0;
      const batchSize = 3; // Process 3 stocks at a time
      const delayBetweenBatches = 2000; // 2 seconds between batches

      for (let i = 0; i < symbolsToFetch.length; i += batchSize) {
        const batch = symbolsToFetch.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (symbol) => {
          try {
            console.log(`[${symbol}] Processing ${++processedCount}/${symbolsToFetch.length}...`);
            
            // STEP 2A: Try to get cached quote (< 5 min)
            const quoteCache = await getCachedQuote(supabase, symbol);
            let currentPrice, name, quote;

            if (quoteCache) {
              console.log(`[${symbol}] Using cached quote`);
              currentPrice = quoteCache.price;
              name = quoteCache.name;
              quote = quoteCache.data;
            } else {
              // Fetch fresh quote
              apiStats.totalRequests++;
              const quoteResult = await fetchWithRetry(
                `https://${RAPIDAPI_HOST}/api/v1/markets/stock/quotes?ticker=${symbol}`,
                { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': RAPIDAPI_HOST }
              );

              if (!quoteResult.success) {
                if (quoteResult.rateLimited) apiStats.rateLimitHits++;
                apiStats.failedRequests++;
                console.log(`[${symbol}] Quote failed`);
                return;
              }

              apiStats.successfulRequests++;
              const quoteData = await quoteResult.response.json();
              quote = quoteData.body?.[0];
              
              if (!quote?.regularMarketPrice) {
                apiStats.failedRequests++;
                return;
              }

              currentPrice = quote.regularMarketPrice;
              name = quote.shortName || quote.longName || symbol;

              // Cache the quote
              await cacheQuote(supabase, symbol, currentPrice, name, quote);
              console.log(`[${symbol}] Quote: $${currentPrice}`);
            }

            // STEP 2B: Get historical data (prefer DB, cache for 24h)
            let prices = await getHistoricalData(supabase, symbol, apiStats);

            if (prices.length < 10) {
              console.log(`[${symbol}] Using synthetic fallback data`);
              prices = generateMinimalSyntheticData(currentPrice, 30);
            }

            // STEP 2C: Calculate prediction
            const prediction = await calculatePrediction(
              symbol, name, currentPrice, prices, quote
            );

            // STEP 2D: Save to database
            try {
              await supabase.from('predictions').upsert([{
                symbol: symbol,
                prediction_date: new Date().toISOString().split('T')[0],
                target_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                current_price: prediction.currentPrice,
                predicted_price: prediction.predictedPrice,
                predicted_upside: prediction.predictedUpside,
                confidence_score: prediction.confidence,
                technical_score: prediction.technicalScore,
                analyst_score: prediction.analystScore,
                sentiment_score: prediction.sentimentScore,
                technical_data: prediction.technical,
                signals: prediction.signals,
                model_version: 'v3.2-cached'
              }], { onConflict: 'symbol,prediction_date' });

              console.log(`[${symbol}] ✓ Cached prediction`);
            } catch (dbErr) {
              console.log(`[${symbol}] DB error:`, dbErr.message);
            }

            predictions.push(prediction);
            
          } catch (error) {
            console.error(`[${symbol}] Error:`, error.message);
          }
        }));

        // Wait between batches to avoid rate limits
        if (i + batchSize < symbolsToFetch.length) {
          console.log(`[BATCH] Waiting ${delayBetweenBatches}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }
    }

    // Log API usage
    if (apiStats.totalRequests > 0) {
      try {
        await supabase.from('api_usage_logs').insert([{
          timestamp: new Date().toISOString(),
          total_requests: apiStats.totalRequests,
          successful_requests: apiStats.successfulRequests,
          failed_requests: apiStats.failedRequests,
          rate_limit_hits: apiStats.rateLimitHits,
          api_provider: 'yahoo-finance15'
        }]);
      } catch (logErr) {
        console.log('Failed to log API usage:', logErr.message);
      }
    }

    predictions.sort((a, b) => b.combinedScore - a.combinedScore);
    const filteredPredictions = predictions.filter(p => p.predictedUpside >= minUpside);

    console.log(`[PREDICT] Complete: ${predictions.length} predictions (${cachedSymbols.size} cached)`);

    return res.status(200).json({
      success: true,
      count: filteredPredictions.length,
      opportunities: filteredPredictions,
      analyzedAt: new Date().toISOString(),
      modelVersion: 'v3.2-cached',
      apiStats: apiStats,
      cacheStats: {
        cached: cachedSymbols.size,
        fresh: symbolsToFetch.length,
        cacheHitRate: `${((cachedSymbols.size / symbols.length) * 100).toFixed(1)}%`
      }
    });

  } catch (error) {
    console.error('[PREDICT] Fatal error:', error);
    return res.status(500).json({ 
      error: 'Prediction failed', 
      message: error.message 
    });
  }
}

// Helper: Fetch with retry and rate limit handling
async function fetchWithRetry(url, headers, maxRetries = 2) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, { headers });
      
      if (response.status === 429) {
        console.log(`Rate limited, attempt ${attempt + 1}/${maxRetries}`);
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        return { success: false, rateLimited: true };
      }

      if (!response.ok) {
        return { success: false, rateLimited: false };
      }

      return { success: true, response };
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return { success: false, rateLimited: false };
}

// Helper: Get cached quote
async function getCachedQuote(supabase, symbol) {
  const cacheTime = new Date(Date.now() - CACHE_TTL.QUOTE).toISOString();
  const { data } = await supabase
    .from('quote_cache')
    .select('*')
    .eq('symbol', symbol)
    .gte('cached_at', cacheTime)
    .single();
  
  return data ? { price: data.price, name: data.name, data: data.quote_data } : null;
}

// Helper: Cache quote
async function cacheQuote(supabase, symbol, price, name, quoteData) {
  await supabase.from('quote_cache').upsert([{
    symbol: symbol,
    price: price,
    name: name,
    quote_data: quoteData,
    cached_at: new Date().toISOString()
  }], { onConflict: 'symbol' });
}

// Helper: Get historical data
async function getHistoricalData(supabase, symbol, apiStats) {
  // Try DB first
  const { data: dbPrices } = await supabase
    .from('stock_prices')
    .select('close, open, high, low, volume, date')
    .eq('symbol', symbol)
    .order('date', { ascending: true })
    .limit(60);

  if (dbPrices && dbPrices.length >= 30) {
    console.log(`[${symbol}] Using ${dbPrices.length} days from DB`);
    return dbPrices;
  }

  // Check if we recently tried and failed
  const { data: failedAttempt } = await supabase
    .from('failed_history_cache')
    .select('*')
    .eq('symbol', symbol)
    .gte('attempted_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .single();

  if (failedAttempt) {
    console.log(`[${symbol}] Recent fetch failed, using fallback`);
    return [];
  }

  // Try API
  apiStats.totalRequests++;
  try {
    const historyResponse = await fetch(
      `https://${RAPIDAPI_HOST}/api/v1/markets/stock/history?ticker=${symbol}&interval=1d`,
      {
        headers: {
          'X-RapidAPI-Key': RAPIDAPI_KEY,
          'X-RapidAPI-Host': RAPIDAPI_HOST
        }
      }
    );

    if (!historyResponse.ok) {
      apiStats.failedRequests++;
      // Cache failure
      await supabase.from('failed_history_cache').upsert([{
        symbol: symbol,
        attempted_at: new Date().toISOString()
      }], { onConflict: 'symbol' });
      return [];
    }

    apiStats.successfulRequests++;
    const historyData = await historyResponse.json();
    let items = historyData.body?.items;
    
    let prices = [];
    if (Array.isArray(items)) {
      prices = items.slice(-60);
    } else if (items && typeof items === 'object') {
      prices = Object.values(items)
        .sort((a, b) => (a.date_utc || 0) - (b.date_utc || 0))
        .slice(-60);
    }

    // Store in DB
    if (prices.length > 0) {
      const priceData = prices.map(p => ({
        symbol: symbol,
        date: p.date,
        date_utc: p.date_utc,
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: p.volume
      }));

      await supabase.from('stock_prices').upsert(priceData, {
        onConflict: 'symbol,date',
        ignoreDuplicates: true
      });
      console.log(`[${symbol}] Stored ${prices.length} days to DB`);
    }

    return prices;
  } catch (err) {
    console.log(`[${symbol}] History fetch error:`, err.message);
    apiStats.failedRequests++;
    return [];
  }
}

async function calculatePrediction(symbol, name, currentPrice, prices, quote) {
  const technical = calculateTechnicalIndicators(prices, currentPrice);
  const technicalScore = calculateTechnicalScore(technical, quote);
  
  const analystTarget = quote.targetMeanPrice?.raw || quote.targetMeanPrice;
  let analystScore = 50;
  if (analystTarget && currentPrice) {
    const analystUpside = ((analystTarget - currentPrice) / currentPrice) * 100;
    analystScore = Math.min(100, Math.max(0, 50 + (analystUpside * 1.5)));
  }

  let sentimentScore = 50;
  const rating = quote.averageAnalystRating;
  if (rating) {
    const ratingStr = String(rating);
    if (ratingStr.includes('Buy') || ratingStr.includes('1')) sentimentScore = 70;
    else if (ratingStr.includes('Hold') || ratingStr.includes('2')) sentimentScore = 50;
    else if (ratingStr.includes('Sell')) sentimentScore = 30;
  }

  const combinedScore = 
    (technicalScore * 0.40) +
    (analystScore * 0.40) +
    (sentimentScore * 0.20);

  const momentumFactor = technical.momentum * 0.4;
  const trendFactor = (technical.currentPrice > technical.sma20 ? 3 : -2) + 
                     (technical.sma20 > technical.sma50 ? 3 : -2);
  const analystInfluence = analystTarget 
    ? ((analystTarget - currentPrice) / currentPrice) * 100 * 0.4
    : 0;
  
  const predictedUpside = momentumFactor + trendFactor + analystInfluence;
  const predictedPrice = currentPrice * (1 + predictedUpside / 100);

  const dataQuality = Math.min(prices.length / 60, 0.8);
  const analystQuality = analystTarget ? 0.9 : 0.6;
  const volatilityPenalty = Math.max(0, 1 - (technical.volatility / 15));
  
  const confidence = ((combinedScore / 100) * 0.5 + 
                     dataQuality * 0.25 + 
                     analystQuality * 0.15 +
                     volatilityPenalty * 0.10) * 100;

  const signals = generateSignals(technical, quote, predictedUpside, analystTarget);
  
  return {
    symbol,
    name,
    currentPrice,
    predictedPrice,
    predictedUpside,
    confidence,
    technicalScore,
    analystScore,
    sentimentScore,
    combinedScore,
    technical,
    signals,
    cached: false
  };
}

function generateMinimalSyntheticData(currentPrice, days) {
  const prices = [];
  let price = currentPrice * 0.95;
  
  for (let i = 0; i < days; i++) {
    const change = (Math.random() - 0.48) * 0.02;
    price = price * (1 + change);
    
    prices.push({
      date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      close: price,
      open: price * 0.995,
      high: price * 1.01,
      low: price * 0.99,
      volume: Math.floor(Math.random() * 5000000) + 1000000
    });
  }
  
  return prices;
}

function calculateTechnicalIndicators(prices, currentPrice) {
  const closes = prices.map(p => p.close);
  const rsi = calculateRSI(closes, 14);
  const sma20 = calculateSMA(closes, Math.min(20, closes.length));
  const sma50 = calculateSMA(closes, Math.min(50, closes.length));
  const momentum = closes.length >= 10 
    ? ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100
    : 0;
  const volatility = calculateVolatility(closes);
  return { rsi, sma20, sma50, momentum, volatility, currentPrice };
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateSMA(prices, period) {
  if (prices.length < period) period = prices.length;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateVolatility(prices) {
  if (prices.length < 2) return 25;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * 100 * Math.sqrt(252);
}

function calculateTechnicalScore(technical, quote) {
  let score = 50;
  if (technical.rsi < 30) score += 20;
  else if (technical.rsi < 40) score += 10;
  else if (technical.rsi > 70) score -= 15;
  else if (technical.rsi > 60) score -= 5;
  if (technical.momentum > 10) score += 20;
  else if (technical.momentum > 5) score += 15;
  else if (technical.momentum > 0) score += 5;
  else if (technical.momentum < -10) score -= 20;
  else if (technical.momentum < -5) score -= 10;
  if (technical.currentPrice > technical.sma20) score += 10;
  if (technical.sma20 > technical.sma50) score += 10;
  if (technical.currentPrice > technical.sma50) score += 5;
  if (technical.volatility < 20) score += 10;
  else if (technical.volatility < 30) score += 5;
  else if (technical.volatility > 50) score -= 10;
  if (quote.fiftyTwoWeekLow && quote.fiftyTwoWeekHigh) {
    const range = quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow;
    const position = (technical.currentPrice - quote.fiftyTwoWeekLow) / range;
    if (position < 0.3) score += 15;
    else if (position > 0.9) score -= 10;
  }
  return Math.min(100, Math.max(0, score));
}

function generateSignals(technical, quote, predictedUpside, analystTarget) {
  const signals = [];
  if (predictedUpside > 15) signals.push({ text: `Strong upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  else if (predictedUpside > 8) signals.push({ text: `Moderate upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  else if (predictedUpside > 3) signals.push({ text: `Modest gain expected: +${predictedUpside.toFixed(1)}%`, bullish: true });
  else if (predictedUpside < 0) signals.push({ text: `Downside risk: ${predictedUpside.toFixed(1)}%`, bullish: false });
  if (technical.rsi < 30) signals.push({ text: 'Oversold - potential bounce opportunity', bullish: true });
  else if (technical.rsi > 70) signals.push({ text: 'Overbought - exercise caution', bullish: false });
  if (technical.momentum > 8) signals.push({ text: 'Strong positive momentum trend', bullish: true });
  else if (technical.momentum < -8) signals.push({ text: 'Negative momentum - downtrend', bullish: false });
  if (technical.currentPrice > technical.sma20 && technical.sma20 > technical.sma50) {
    signals.push({ text: 'Bullish: Price above key moving averages', bullish: true });
  }
  if (analystTarget) {
    const analystUpside = ((analystTarget - technical.currentPrice) / technical.currentPrice) * 100;
    if (analystUpside > 12) signals.push({ text: `Analyst target: +${analystUpside.toFixed(1)}% upside`, bullish: true });
  }
  return signals.slice(0, 5);
}
