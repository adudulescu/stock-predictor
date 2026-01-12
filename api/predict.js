// api/predict.js - Real data only, no synthetic fallback
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
    const { symbols, minUpside = 0 } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: 'Symbols array required' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const predictions = [];
    const apiStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0
    };

    // Process in batches to avoid rate limits
    for (const symbol of symbols) {
      try {
        console.log(`[${symbol}] Fetching real-time data...`);
        
        // Get real-time quote
        apiStats.totalRequests++;
        const quoteResponse = await fetch(
          `https://${RAPIDAPI_HOST}/api/v1/markets/stock/quotes?ticker=${symbol}`,
          {
            headers: {
              'X-RapidAPI-Key': RAPIDAPI_KEY,
              'X-RapidAPI-Host': RAPIDAPI_HOST
            }
          }
        );

        if (!quoteResponse.ok) {
          if (quoteResponse.status === 429) {
            apiStats.rateLimitHits++;
            console.log(`[${symbol}] Rate limited, waiting 3s...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
          }
          apiStats.failedRequests++;
          console.log(`[${symbol}] Quote failed: ${quoteResponse.status}`);
          continue;
        }

        const quoteData = await quoteResponse.json();
        const quote = quoteData.body?.[0];
        
        if (!quote?.regularMarketPrice) {
          apiStats.failedRequests++;
          console.log(`[${symbol}] No quote data`);
          continue;
        }

        apiStats.successfulRequests++;
        const currentPrice = quote.regularMarketPrice;
        const name = quote.shortName || quote.longName || symbol;

        // Get historical data from Supabase (from initialization)
        const { data: historicalPrices } = await supabase
          .from('stock_prices')
          .select('*')
          .eq('symbol', symbol)
          .order('date', { ascending: true })
          .limit(60);

        // If no historical data in DB, fetch from API
        let prices = historicalPrices || [];
        
        if (prices.length < 20) {
          console.log(`[${symbol}] Fetching historical data from API...`);
          apiStats.totalRequests++;
          
          const historyResponse = await fetch(
            `https://${RAPIDAPI_HOST}/api/v1/markets/stock/history?ticker=${symbol}&interval=1d`,
            {
              headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': RAPIDAPI_HOST
              }
            }
          );

          if (historyResponse.ok) {
            apiStats.successfulRequests++;
            const historyData = await historyResponse.json();
            const items = historyData.body?.items || {};
            
            if (Array.isArray(items)) {
              prices = items.slice(-60);
            } else if (typeof items === 'object') {
              prices = Object.values(items)
                .sort((a, b) => (a.date_utc || 0) - (b.date_utc || 0))
                .slice(-60);
            }

            // Store in Supabase for future use
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
                onConflict: 'symbol,date'
              });
            }
          } else {
            if (historyResponse.status === 429) apiStats.rateLimitHits++;
            apiStats.failedRequests++;
          }
        }

        // Skip if insufficient real data
        if (prices.length < 20) {
          console.log(`[${symbol}] Insufficient historical data (${prices.length} days) - SKIPPING`);
          continue;
        }

        console.log(`[${symbol}] Using ${prices.length} days of REAL historical data`);

        // Calculate technical indicators from REAL data
        const technical = calculateTechnicalIndicators(prices, currentPrice);

        // Get analyst data
        const analystTarget = quote.targetMeanPrice?.raw || quote.targetMeanPrice;
        let analystScore = 50;
        
        if (analystTarget && currentPrice) {
          const analystUpside = ((analystTarget - currentPrice) / currentPrice) * 100;
          analystScore = Math.min(100, Math.max(0, 50 + (analystUpside * 1.5)));
        }

        const technicalScore = calculateTechnicalScore(technical, quote);
        
        let sentimentScore = 50;
        const rating = quote.averageAnalystRating;
        if (rating) {
          const ratingStr = String(rating);
          if (ratingStr.includes('Buy') || ratingStr.includes('1')) sentimentScore = 70;
          else if (ratingStr.includes('Hold') || ratingStr.includes('2')) sentimentScore = 50;
          else if (ratingStr.includes('Sell')) sentimentScore = 30;
        }

        const weights = { technical: 0.40, analyst: 0.40, sentiment: 0.20 };
        const combinedScore = 
          (technicalScore * weights.technical) +
          (analystScore * weights.analyst) +
          (sentimentScore * weights.sentiment);

        // Prediction calculation
        const momentumFactor = technical.momentum * 0.4;
        const trendFactor = (technical.currentPrice > technical.sma20 ? 3 : -2) + 
                           (technical.sma20 > technical.sma50 ? 3 : -2);
        const analystInfluence = analystTarget 
          ? ((analystTarget - currentPrice) / currentPrice) * 100 * 0.4
          : 0;
        
        const predictedUpside = momentumFactor + trendFactor + analystInfluence;
        const predictedPrice = currentPrice * (1 + predictedUpside / 100);

        const dataQuality = Math.min(prices.length / 60, 1);
        const analystQuality = analystTarget ? 0.9 : 0.6;
        const volatilityPenalty = Math.max(0, 1 - (technical.volatility / 15));
        
        const confidence = ((combinedScore / 100) * 0.5 + 
                           dataQuality * 0.25 + 
                           analystQuality * 0.15 +
                           volatilityPenalty * 0.10) * 100;

        const signals = generateSignals(technical, quote, predictedUpside, analystTarget);
        
        const prediction = {
          symbol: symbol,
          name: name,
          currentPrice: currentPrice,
          predictedPrice: predictedPrice,
          predictedUpside: predictedUpside,
          confidence: confidence,
          technicalScore: technicalScore,
          analystScore: analystScore,
          sentimentScore: sentimentScore,
          combinedScore: combinedScore,
          technical: technical,
          signals: signals,
          dataSource: 'REAL'
        };

        await supabase.from('predictions').upsert([{
          symbol: symbol,
          prediction_date: new Date().toISOString().split('T')[0],
          target_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          current_price: currentPrice,
          predicted_price: predictedPrice,
          predicted_upside: predictedUpside,
          confidence_score: confidence,
          technical_score: technicalScore,
          analyst_score: analystScore,
          sentiment_score: sentimentScore,
          technical_data: technical,
          signals: signals,
          model_version: 'v3.0-real'
        }], {
          onConflict: 'symbol,prediction_date'
        });

        predictions.push(prediction);
        console.log(`[${symbol}] ✓ Prediction complete: ${predictedUpside.toFixed(1)}% upside`);

        // Rate limiting - wait 500ms between stocks
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`[${symbol}] Error:`, error.message);
      }
    }

    // Log API usage to database
    await supabase.from('api_usage_logs').insert([{
      timestamp: new Date().toISOString(),
      total_requests: apiStats.totalRequests,
      successful_requests: apiStats.successfulRequests,
      failed_requests: apiStats.failedRequests,
      rate_limit_hits: apiStats.rateLimitHits,
      api_provider: 'yahoo-finance15'
    }]);

    predictions.sort((a, b) => b.combinedScore - a.combinedScore);
    const filteredPredictions = predictions.filter(p => p.predictedUpside >= minUpside);

    return res.status(200).json({
      success: true,
      count: filteredPredictions.length,
      opportunities: filteredPredictions,
      analyzedAt: new Date().toISOString(),
      modelVersion: 'v3.0-real',
      apiStats: apiStats
    });

  } catch (error) {
    console.error('Prediction error:', error);
    return res.status(500).json({ 
      error: 'Prediction failed', 
      message: error.message 
    });
  }
}

function calculateTechnicalIndicators(prices, currentPrice) {
  const closes = prices.map(p => p.close);
  
  const rsi = calculateRSI(closes, 14);
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, Math.min(50, closes.length));
  
  const momentum = closes.length >= 10 
    ? ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100
    : 0;
  
  const volatility = calculateVolatility(closes);
  
  return { rsi, sma20, sma50, momentum, volatility, currentPrice };
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
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
  if (prices.length < 2) return 0;
  
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
  
  if (predictedUpside > 15) {
    signals.push({ text: `Strong upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  } else if (predictedUpside > 8) {
    signals.push({ text: `Moderate upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  } else if (predictedUpside > 3) {
    signals.push({ text: `Modest gain expected: +${predictedUpside.toFixed(1)}%`, bullish: true });
  }
  
  if (technical.rsi < 30) {
    signals.push({ text: 'Oversold - potential bounce opportunity', bullish: true });
  } else if (technical.rsi > 70) {
    signals.push({ text: 'Overbought - exercise caution', bullish: false });
  }
  
  if (technical.momentum > 8) {
    signals.push({ text: 'Strong positive momentum trend', bullish: true });
  } else if (technical.momentum < -8) {
    signals.push({ text: 'Negative momentum - downtrend', bullish: false });
  }
  
  if (technical.currentPrice > technical.sma20 && technical.sma20 > technical.sma50) {
    signals.push({ text: 'Bullish: Price above key moving averages', bullish: true });
  } else if (technical.currentPrice < technical.sma50) {
    signals.push({ text: 'Below 50-day average - weak trend', bullish: false });
  }
  
  if (analystTarget) {
    const analystUpside = ((analystTarget - technical.currentPrice) / technical.currentPrice) * 100;
    if (analystUpside > 12) {
      signals.push({ text: `Analyst target: +${analystUpside.toFixed(1)}% upside`, bullish: true });
    }
  }
  
  if (technical.volatility > 40) {
    signals.push({ text: 'High volatility - elevated risk', bullish: false });
  }
  
  return signals.slice(0, 6);
}
