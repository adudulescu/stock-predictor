// api/analyze.js - Updated to use prediction system
// This orchestrates data collection and prediction
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
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
    const { symbols, minUpside = 10, forceRefresh = false } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: 'Symbols array required' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Check if we have recent predictions (less than 1 hour old)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    if (!forceRefresh) {
      const { data: existingPredictions } = await supabase
        .from('predictions')
        .select('*')
        .in('symbol', symbols)
        .gte('created_at', oneHourAgo)
        .eq('prediction_date', new Date().toISOString().split('T')[0]);

      if (existingPredictions && existingPredictions.length > 0) {
        // Return cached predictions
        const opportunities = existingPredictions
          .filter(p => p.predicted_upside >= minUpside)
          .map(p => ({
            symbol: p.symbol,
            name: p.symbol,
            price: p.current_price,
            target: p.predicted_price,
            upside: p.predicted_upside,
            confidence: p.confidence_score,
            technicalScore: p.technical_score,
            analystScore: p.analyst_score,
            sentimentScore: p.sentiment_score,
            signals: [
              { text: `30-day predicted upside: +${p.predicted_upside.toFixed(1)}%`, bullish: true },
              { text: `Confidence: ${p.confidence_score.toFixed(0)}%`, bullish: true },
              { text: `Technical score: ${p.technical_score.toFixed(0)}/100`, bullish: p.technical_score > 60 }
            ]
          }))
          .sort((a, b) => b.upside - a.upside);

        return res.status(200).json({
          success: true,
          count: opportunities.length,
          opportunities: opportunities,
          cached: true,
          analyzedAt: new Date().toISOString()
        });
      }
    }

    // Step 1: Check if we have historical data, if not collect it
    const { data: existingPrices } = await supabase
      .from('stock_prices')
      .select('symbol, date')
      .in('symbol', symbols)
      .order('date', { ascending: false })
      .limit(symbols.length * 30);

    const symbolsWithData = new Set(existingPrices?.map(p => p.symbol) || []);
    const symbolsNeedingData = symbols.filter(s => !symbolsWithData.has(s));

    // Collect data for symbols that don't have it
    if (symbolsNeedingData.length > 0) {
      console.log(`Collecting data for: ${symbolsNeedingData.join(', ')}`);
      
      // Get the base URL from request headers
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['host'];
      const baseUrl = host ? `${protocol}://${host}` : 'http://localhost:3000';
      
      try {
        const collectResponse = await fetch(`${baseUrl}/api/collect-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: symbolsNeedingData })
        });
        
        if (!collectResponse.ok) {
          console.warn('Data collection had issues:', await collectResponse.text());
        }
      } catch (collectError) {
        console.error('Data collection error:', collectError);
        // Continue anyway with available data
      }
    }

    // Step 2: Generate predictions
    console.log('Generating predictions...');
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['host'];
    const baseUrl = host ? `${protocol}://${host}` : 'http://localhost:3000';
    
    const predictResponse = await fetch(`${baseUrl}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols, minUpside })
    });

    if (!predictResponse.ok) {
      const errorText = await predictResponse.text();
      throw new Error(`Prediction failed: ${errorText}`);
    }

    const predictions = await predictResponse.json();

    return res.status(200).json({
      success: true,
      count: predictions.count,
      opportunities: predictions.opportunities,
      cached: false,
      analyzedAt: predictions.analyzedAt,
      modelVersion: predictions.modelVersion
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message 
    });
  }
}