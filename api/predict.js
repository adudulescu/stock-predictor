// api/predict.js
// Generates 30-day stock predictions based on multiple factors
import { createClient } from '@supabase/supabase-js';

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
    const { symbols, minUpside = 10 } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: 'Symbols array required' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const predictions = [];

    for (const symbol of symbols) {
      try {
        // 1. Get historical prices (last 30 days)
        const { data: prices } = await supabase
          .from('stock_prices')
          .select('*')
          .eq('symbol', symbol)
          .order('date', { ascending: false })
          .limit(30);

        if (!prices || prices.length < 10) {
          console.log(`Insufficient data for ${symbol}`);
          continue;
        }

        // 2. Get analyst data
        const { data: analystData } = await supabase
          .from('analyst_data')
          .select('*')
          .eq('symbol', symbol)
          .order('date', { ascending: false })
          .limit(1);

        const analyst = analystData?.[0];

        // 3. Calculate technical indicators
        const currentPrice = prices[0].close;
        const technical = calculateTechnicalIndicators(prices);

        // 4. Calculate analyst score (0-100)
        let analystScore = 50; // Neutral default
        if (analyst && analyst.target_mean && currentPrice) {
          const analystUpside = ((analyst.target_mean - currentPrice) / currentPrice) * 100;
          // Scale to 0-100 where 50 is neutral, >50 is bullish
          analystScore = Math.min(100, Math.max(0, 50 + (analystUpside * 2)));
        }

        // 5. Calculate technical score (0-100)
        const technicalScore = calculateTechnicalScore(technical);

        // 6. Sentiment score (placeholder - would need news API)
        const sentimentScore = 50; // Neutral for now

        // 7. Combine scores with weights
        const weights = {
          technical: 0.40,
          analyst: 0.40,
          sentiment: 0.20
        };

        const combinedScore = 
          (technicalScore * weights.technical) +
          (analystScore * weights.analyst) +
          (sentimentScore * weights.sentiment);

        // 8. Calculate predicted upside
        // Formula: Base upside + momentum adjustment + analyst influence
        const momentumUpside = technical.momentum * 0.5;
        const analystInfluence = analyst && analyst.target_mean 
          ? ((analyst.target_mean - currentPrice) / currentPrice) * 100 * 0.3 
          : 0;
        
        const predictedUpside = momentumUpside + analystInfluence;
        const predictedPrice = currentPrice * (1 + predictedUpside / 100);

        // 9. Calculate confidence based on data quality
        const dataQuality = prices.length / 30; // 0-1
        const analystQuality = analyst ? 1 : 0.5;
        const confidence = ((combinedScore / 100) * 0.6 + dataQuality * 0.3 + analystQuality * 0.1) * 100;

        // Only include if meets minimum upside
        if (predictedUpside >= minUpside) {
          const prediction = {
            symbol: symbol,
            name: symbol, // Would get from API
            currentPrice: currentPrice,
            predictedPrice: predictedPrice,
            predictedUpside: predictedUpside,
            confidence: confidence,
            technicalScore: technicalScore,
            analystScore: analystScore,
            sentimentScore: sentimentScore,
            combinedScore: combinedScore,
            technical: technical,
            signals: generateSignals(technical, analyst, predictedUpside)
          };

          // Store prediction in database
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
            model_version: 'v1.0'
          }], {
            onConflict: 'symbol,prediction_date'
          });

          predictions.push(prediction);
        }

      } catch (error) {
        console.error(`Error predicting ${symbol}:`, error);
      }
    }

    // Sort by combined score
    predictions.sort((a, b) => b.combinedScore - a.combinedScore);

    return res.status(200).json({
      success: true,
      count: predictions.length,
      opportunities: predictions,
      analyzedAt: new Date().toISOString(),
      modelVersion: 'v1.0'
    });

  } catch (error) {
    console.error('Prediction error:', error);
    return res.status(500).json({ 
      error: 'Prediction failed', 
      message: error.message 
    });
  }
}

// Calculate technical indicators from price history
function calculateTechnicalIndicators(prices) {
  const closes = prices.map(p => p.close).reverse();
  
  // RSI (14-day)
  const rsi = calculateRSI(closes, 14);
  
  // Moving averages
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, Math.min(50, closes.length));
  
  // Momentum (10-day rate of change)
  const momentum = closes.length >= 10 
    ? ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100
    : 0;
  
  // Volatility (30-day)
  const volatility = calculateVolatility(closes);
  
  return {
    rsi,
    sma20,
    sma50,
    momentum,
    volatility,
    currentPrice: closes[closes.length - 1]
  };
}

// Calculate RSI
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

// Calculate Simple Moving Average
function calculateSMA(prices, period) {
  if (prices.length < period) period = prices.length;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Calculate volatility (standard deviation)
function calculateVolatility(prices) {
  if (prices.length < 2) return 0;
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

// Calculate technical score (0-100)
function calculateTechnicalScore(technical) {
  let score = 50; // Start neutral
  
  // RSI component (30-70 is good, <30 oversold, >70 overbought)
  if (technical.rsi < 30) score += 15; // Oversold = bullish
  else if (technical.rsi > 70) score -= 15; // Overbought = bearish
  
  // Momentum component
  if (technical.momentum > 5) score += 15;
  else if (technical.momentum > 0) score += 5;
  else if (technical.momentum < -5) score -= 15;
  else score -= 5;
  
  // Moving average crossover
  if (technical.currentPrice > technical.sma20) score += 10;
  if (technical.sma20 > technical.sma50) score += 10;
  
  // Volatility (lower is better for predictions)
  if (technical.volatility < 2) score += 10;
  else if (technical.volatility > 5) score -= 10;
  
  return Math.min(100, Math.max(0, score));
}

// Generate trading signals
function generateSignals(technical, analyst, predictedUpside) {
  const signals = [];
  
  if (predictedUpside > 15) {
    signals.push({ text: `Strong 30-day upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  } else if (predictedUpside > 10) {
    signals.push({ text: `Moderate 30-day upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  }
  
  if (technical.rsi < 30) {
    signals.push({ text: 'RSI shows oversold conditions', bullish: true });
  }
  
  if (technical.momentum > 5) {
    signals.push({ text: 'Strong positive momentum', bullish: true });
  }
  
  if (technical.currentPrice > technical.sma20 && technical.sma20 > technical.sma50) {
    signals.push({ text: 'Golden cross pattern forming', bullish: true });
  }
  
  if (analyst && analyst.target_mean) {
    const analystUpside = ((analyst.target_mean - technical.currentPrice) / technical.currentPrice) * 100;
    if (analystUpside > 10) {
      signals.push({ text: `Analyst target: +${analystUpside.toFixed(1)}%`, bullish: true });
    }
  }
  
  return signals;
}