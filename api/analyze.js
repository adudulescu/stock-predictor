// api/analyze.js
// Serverless function to analyze stocks

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
    
    if (!RAPIDAPI_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Fetch stock data from Yahoo Finance
    const symbolsParam = symbols.join(',');
    const url = `https://apidojo-yahoo-finance-v1.p.rapidapi.com/market/v2/get-quotes?region=US&symbols=${symbolsParam}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'apidojo-yahoo-finance-v1.p.rapidapi.com'
      }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.quoteResponse || !data.quoteResponse.result) {
      return res.status(500).json({ error: 'Invalid API response' });
    }

    // Process and analyze stocks
    const opportunities = [];
    
    for (const quote of data.quoteResponse.result) {
      const price = quote.regularMarketPrice || 0;
      const target = quote.targetMeanPrice || null;
      const yearLow = quote.fiftyTwoWeekLow || 0;
      const yearHigh = quote.fiftyTwoWeekHigh || 0;
      
      if (price === 0 || !target) continue;
      
      // Calculate upside potential
      const upside = ((target - price) / price) * 100;
      
      if (upside < minUpside) continue;
      
      // Calculate signals
      const signals = [];
      let score = 0;
      
      // Analyst upside
      if (upside > 15) {
        signals.push({ text: 'Strong analyst upside', bullish: true });
        score += 3;
      } else if (upside > 10) {
        signals.push({ text: 'Moderate analyst upside', bullish: true });
        score += 2;
      } else if (upside > 5) {
        signals.push({ text: 'Slight analyst upside', bullish: true });
        score += 1;
      }
      
      // Near 52-week low
      if (yearLow > 0 && price <= yearLow * 1.15) {
        signals.push({ text: 'Near 52-week low', bullish: true });
        score += 2;
      }
      
      // Analyst rating
      const rating = quote.averageAnalystRating || quote.recommendationKey || '';
      if (rating.toLowerCase().includes('buy') || rating.toLowerCase().includes('outperform')) {
        signals.push({ text: 'Analyst Buy rating', bullish: true });
        score += 2;
      }
      
      // Recent dip
      const changePct = quote.regularMarketChangePercent || 0;
      if (changePct < -2) {
        signals.push({ text: 'Recent price dip', bullish: true });
        score += 1;
      }
      
      opportunities.push({
        symbol: quote.symbol,
        name: quote.shortName || quote.symbol,
        price: price,
        target: target,
        upside: upside,
        yearLow: yearLow,
        yearHigh: yearHigh,
        changePct: changePct,
        volume: quote.regularMarketVolume || 0,
        marketCap: quote.marketCap || 0,
        pe: quote.trailingPE || 0,
        rating: rating,
        signals: signals,
        score: score,
        timestamp: new Date().toISOString()
      });
    }
    
    // Sort by score then upside
    opportunities.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.upside - a.upside;
    });
    
    return res.status(200).json({
      success: true,
      count: opportunities.length,
      opportunities: opportunities,
      analyzedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message 
    });
  }
}