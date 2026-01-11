// api/predict.js - Updated to use Yahoo Finance API
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

    console.log('Generating predictions for:', symbols);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const predictions = [];

    for (const symbol of symbols) {
      try {
        console.log(`Fetching data for ${symbol}...`);
        
        // 1. Get real-time quote data
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
          console.error(`Failed to fetch quote for ${symbol}`);
          continue;
        }

        const quoteData = await quoteResponse.json();
        const quote = quoteData.body?.[0];
        
        if (!quote) {
          console.log(`No quote data for ${symbol}`);
          continue;
        }

        const currentPrice = quote.regularMarketPrice;
        const name = quote.shortName || symbol;

        // 2. Get historical data (last 90 days)
        const endDate = Math.floor(Date.now() / 1000);
        const startDate = endDate - (90 * 24 * 60 * 60); // 90 days ago

        const historyResponse = await fetch(
          `https://${RAPIDAPI_HOST}/api/v2/stock/history?symbol=${symbol}&interval=1d&diffandsplits=false`,
          {
            headers: {
              'X-RapidAPI-Key': RAPIDAPI_KEY,
              'X-RapidAPI-Host': RAPIDAPI_HOST
            }
          }
        );

        let prices = [];
        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          const items = historyData.body?.items || {};
          
          prices = Object.values(items)
            .sort((a, b) => a.date_utc - b.date_utc)
            .slice(-60) // Last 60 days
            .map(item => ({
              date: item.date,
              close: item.close,
              open: item.open,
              high: item.high,
              low: item.low,
              volume: item.volume
            }));
        }

        if (prices.length < 10) {
          console.log(`Insufficient historical data for ${symbol}`);
          continue;
        }

        // 3. Calculate technical indicators
        const technical = calculateTechnicalIndicators(prices, currentPrice);

        // 4. Get analyst data from quote
        const analystTargetMean = quote.targetMeanPrice || null;
        let analystScore = 50;
        
        if (analystTargetMean && currentPrice) {
          const analystUpside = ((analystTargetMean - currentPrice) / currentPrice) * 100;
          analystScore = Math.min(100, Math.max(0, 50 + (analystUpside * 1.5)));
        }

        // 5. Calculate technical score
        const technicalScore = calculateTechnicalScore(technical, quote);

        // 6. Get sentiment from analyst rating
        let sentimentScore = 50;
        const rating = quote.averageAnalystRating;
        if (rating) {
          if (rating.includes('Buy') || rating.includes('1')) sentimentScore = 75;
          else if (rating.includes('Hold') || rating.includes('2')) sentimentScore = 50;
          else if (rating.includes('Sell')) sentimentScore = 25;
        }

        // 7. Combine scores
        const weights = { technical: 0.40, analyst: 0.40, sentiment: 0.20 };
        const combinedScore = 
          (technicalScore * weights.technical) +
          (analystScore * weights.analyst) +
          (sentimentScore * weights.sentiment);

        // 8. Calculate predicted upside
        const momentumFactor = technical.momentum * 0.4;
        const trendFactor = (technical.currentPrice > technical.sma20 ? 3 : -2) + 
                           (technical.sma20 > technical.sma50 ? 3 : -2);
        const analystInfluence = analystTargetMean 
          ? ((analystTargetMean - currentPrice) / currentPrice) * 100 * 0.4
          : 0;
        const volatilityAdjustment = Math.min(5, technical.volatility) * 0.5;
        
        const predictedUpside = momentumFactor + trendFactor + analystInfluence + volatilityAdjustment;
        const predictedPrice = currentPrice * (1 + predictedUpside / 100);

        // 9. Calculate confidence
        const dataQuality = Math.min(prices.length / 60, 1);
        const analystQuality = analystTargetMean ? 1 : 0.6;
        const volatilityPenalty = Math.max(0, 1 - (technical.volatility / 10));
        
        const confidence = ((combinedScore / 100) * 0.5 + 
                           dataQuality * 0.2 + 
                           analystQuality * 0.15 +
                           volatilityPenalty * 0.15) * 100;

        // Only include if meets minimum upside
        if (predictedUpside >= minUpside) {
          const signals = generateSignals(technical, quote, predictedUpside, analystTargetMean);
          
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
            signals: signals
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
            technical_data: technical,
            signals: signals,
            model_version: 'v2.0'
          }], {
            onConflict: 'symbol,prediction_date'
          });

          predictions.push(prediction);
        }

        // Rate limiting - wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`Error predicting ${symbol}:`, error);
      }
    }

    predictions.sort((a, b) => b.combinedScore - a.combinedScore);

    return res.status(200).json({
      success: true,
      count: predictions.length,
      opportunities: predictions,
      analyzedAt: new Date().toISOString(),
      modelVersion: 'v2.0'
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
  const sma50 = calculateSMA(closes, 50);
  
  const momentum = closes.length >= 10 
    ? ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100
    : 0;
  
  const volatility = calculateVolatility(closes);
  
  return {
    rsi,
    sma20,
    sma50,
    momentum,
    volatility,
    currentPrice
  };
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
  return Math.sqrt(variance) * 100 * Math.sqrt(252); // Annualized
}

function calculateTechnicalScore(technical, quote) {
  let score = 50;
  
  // RSI component
  if (technical.rsi < 30) score += 20;
  else if (technical.rsi < 40) score += 10;
  else if (technical.rsi > 70) score -= 20;
  else if (technical.rsi > 60) score -= 10;
  
  // Momentum component
  if (technical.momentum > 10) score += 20;
  else if (technical.momentum > 5) score += 15;
  else if (technical.momentum > 0) score += 5;
  else if (technical.momentum < -10) score -= 20;
  else if (technical.momentum < -5) score -= 15;
  else score -= 5;
  
  // Moving average trend
  if (technical.currentPrice > technical.sma20) score += 10;
  if (technical.sma20 > technical.sma50) score += 10;
  if (technical.currentPrice > technical.sma50) score += 5;
  
  // Volatility (moderate is best)
  if (technical.volatility < 20) score += 10;
  else if (technical.volatility < 30) score += 5;
  else if (technical.volatility > 50) score -= 15;
  else if (technical.volatility > 40) score -= 10;
  
  // Price vs 52-week range
  if (quote.fiftyTwoWeekLow && quote.fiftyTwoWeekHigh) {
    const range = quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow;
    const position = (technical.currentPrice - quote.fiftyTwoWeekLow) / range;
    if (position < 0.3) score += 15; // Near lows = opportunity
    else if (position > 0.9) score -= 15; // Near highs = risky
  }
  
  return Math.min(100, Math.max(0, score));
}

function generateSignals(technical, quote, predictedUpside, analystTarget) {
  const signals = [];
  
  if (predictedUpside > 15) {
    signals.push({ text: `Strong 30-day upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  } else if (predictedUpside > 10) {
    signals.push({ text: `Moderate 30-day upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  } else if (predictedUpside > 5) {
    signals.push({ text: `Modest 30-day upside: +${predictedUpside.toFixed(1)}%`, bullish: true });
  }
  
  if (technical.rsi < 30) {
    signals.push({ text: 'Oversold (RSI < 30) - potential bounce', bullish: true });
  } else if (technical.rsi > 70) {
    signals.push({ text: 'Overbought (RSI > 70) - caution advised', bullish: false });
  }
  
  if (technical.momentum > 10) {
    signals.push({ text: 'Strong positive momentum (+10%)', bullish: true });
  } else if (technical.momentum > 5) {
    signals.push({ text: 'Positive momentum trend', bullish: true });
  }
  
  if (technical.currentPrice > technical.sma20 && technical.sma20 > technical.sma50) {
    signals.push({ text: 'Bullish trend: Price above moving averages', bullish: true });
  } else if (technical.currentPrice < technical.sma20 && technical.sma20 < technical.sma50) {
    signals.push({ text: 'Bearish trend: Price below moving averages', bullish: false });
  }
  
  if (analystTarget) {
    const analystUpside = ((analystTarget - technical.currentPrice) / technical.currentPrice) * 100;
    if (analystUpside > 15) {
      signals.push({ text: `Analyst target: +${analystUpside.toFixed(1)}% upside`, bullish: true });
    } else if (analystUpside > 10) {
      signals.push({ text: `Analyst target: +${analystUpside.toFixed(1)}%`, bullish: true });
    }
  }
  
  if (quote.fiftyTwoWeekLow && quote.fiftyTwoWeekHigh) {
    const range = quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow;
    const position = (technical.currentPrice - quote.fiftyTwoWeekLow) / range;
    if (position < 0.2) {
      signals.push({ text: 'Near 52-week low - value opportunity', bullish: true });
    } else if (position > 0.9) {
      signals.push({ text: 'Near 52-week high - proceed with caution', bullish: false });
    }
  }
  
  if (technical.volatility > 40) {
    signals.push({ text: 'High volatility - increased risk', bullish: false });
  }
  
  return signals.slice(0, 6);
}
