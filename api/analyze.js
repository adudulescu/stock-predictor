// api/analyze.js - Updated to use Yahoo Finance API
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
    const { symbols, minUpside = 0 } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: 'Symbols array required' });
    }

    console.log('Analyzing symbols:', symbols);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Check for recent predictions (less than 4 hours old)
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    
    const { data: existingPredictions } = await supabase
      .from('predictions')
      .select('*')
      .in('symbol', symbols)
      .gte('created_at', fourHoursAgo);

    if (existingPredictions && existingPredictions.length > 0) {
      const opportunities = existingPredictions
        .filter(p => p.predicted_upside >= minUpside)
        .map(p => ({
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
          signals: p.signals || []
        }))
        .sort((a, b) => b.combinedScore - a.combinedScore);

      return res.status(200).json({
        success: true,
        count: opportunities.length,
        opportunities: opportunities,
        cached: true,
        analyzedAt: new Date().toISOString()
      });
    }

    // Generate new predictions using real API
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
      console.error('Predict API error:', errorText);
      throw new Error(`Prediction API error: ${predictResponse.status}`);
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
