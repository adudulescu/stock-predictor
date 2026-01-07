// api/initialize-data.js
// One-time initialization to populate historical data for all stocks
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // List of S&P 500 top stocks to initialize
    const symbols = [
      'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B',
      'UNH', 'XOM', 'JPM', 'JNJ', 'V', 'PG', 'MA', 'HD', 'CVX', 'MRK',
      'ABBV', 'LLY', 'AVGO', 'PEP', 'COST', 'KO', 'WMT', 'ADBE', 'MCD',
      'CSCO', 'ACN', 'TMO', 'CRM', 'ABT', 'DHR', 'VZ', 'TXN', 'ORCL',
      'NKE', 'DIS', 'NFLX', 'INTC'
    ];

    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    // Process in batches to avoid timeout
    const batchSize = 10;
    const results = {
      totalSymbols: symbols.length,
      processed: 0,
      batches: []
    };

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      
      console.log(`Processing batch ${i / batchSize + 1}: ${batch.join(', ')}`);
      
      try {
        const response = await fetch(`${baseUrl}/api/collect-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: batch })
        });

        const result = await response.json();
        results.batches.push({
          batch: i / batchSize + 1,
          symbols: batch,
          success: result.success,
          results: result.results
        });
        results.processed += batch.length;

        // Small delay between batches
        if (i + batchSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        console.error(`Batch ${i / batchSize + 1} error:`, error);
        results.batches.push({
          batch: i / batchSize + 1,
          symbols: batch,
          error: error.message
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