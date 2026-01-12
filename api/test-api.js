// api/test-api.js - Diagnostic endpoint to test Yahoo Finance API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const RAPIDAPI_KEY = '58cacb4713mshe9e5eb3e89dad26p12c9d0jsn2113d69535c8';
  const RAPIDAPI_HOST = 'yahoo-finance15.p.rapidapi.com';
  const testSymbol = req.query.symbol || 'AAPL';

  const results = {
    symbol: testSymbol,
    timestamp: new Date().toISOString(),
    tests: []
  };

  try {
    // Test 1: Quote endpoint (v1)
    console.log(`Testing quote endpoint for ${testSymbol}...`);
    try {
      const quoteResponse = await fetch(
        `https://${RAPIDAPI_HOST}/api/v1/markets/stock/quotes?ticker=${testSymbol}`,
        {
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': RAPIDAPI_HOST
          }
        }
      );

      const quoteData = await quoteResponse.json();
      
      results.tests.push({
        name: 'Quote Endpoint (v1)',
        endpoint: `/api/v1/markets/stock/quotes?ticker=${testSymbol}`,
        status: quoteResponse.status,
        statusText: quoteResponse.statusText,
        success: quoteResponse.ok,
        dataReceived: quoteData ? 'Yes' : 'No',
        sampleData: quoteData ? {
          body: quoteData.body ? `${quoteData.body.length} items` : 'No body',
          firstItem: quoteData.body?.[0] ? {
            symbol: quoteData.body[0].symbol,
            price: quoteData.body[0].regularMarketPrice,
            name: quoteData.body[0].shortName
          } : null
        } : null,
        rawResponse: JSON.stringify(quoteData).substring(0, 500)
      });
    } catch (error) {
      results.tests.push({
        name: 'Quote Endpoint (v1)',
        success: false,
        error: error.message
      });
    }

    // Test 2: History endpoint (v1)
    console.log(`Testing history endpoint for ${testSymbol}...`);
    try {
      const historyResponse = await fetch(
        `https://${RAPIDAPI_HOST}/api/v1/markets/stock/history?ticker=${testSymbol}&interval=1d`,
        {
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': RAPIDAPI_HOST
          }
        }
      );

      const historyData = await historyResponse.json();
      
      results.tests.push({
        name: 'History Endpoint (v1)',
        endpoint: `/api/v1/markets/stock/history?ticker=${testSymbol}&interval=1d`,
        status: historyResponse.status,
        statusText: historyResponse.statusText,
        success: historyResponse.ok,
        dataReceived: historyData ? 'Yes' : 'No',
        sampleData: historyData ? {
          bodyType: historyData.body?.items ? (Array.isArray(historyData.body.items) ? 'Array' : 'Object') : 'Unknown',
          itemCount: historyData.body?.items ? (Array.isArray(historyData.body.items) ? historyData.body.items.length : Object.keys(historyData.body.items).length) : 0,
          firstItem: historyData.body?.items ? (Array.isArray(historyData.body.items) ? historyData.body.items[0] : Object.values(historyData.body.items)[0]) : null
        } : null,
        rawResponse: JSON.stringify(historyData).substring(0, 500)
      });
    } catch (error) {
      results.tests.push({
        name: 'History Endpoint (v1)',
        success: false,
        error: error.message
      });
    }

    // Test 3: History endpoint (v2) - Alternative
    console.log(`Testing history endpoint v2 for ${testSymbol}...`);
    try {
      const historyV2Response = await fetch(
        `https://${RAPIDAPI_HOST}/api/v2/stock/history?symbol=${testSymbol}&interval=1d&diffandsplits=false`,
        {
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': RAPIDAPI_HOST
          }
        }
      );

      const historyV2Data = await historyV2Response.json();
      
      results.tests.push({
        name: 'History Endpoint (v2)',
        endpoint: `/api/v2/stock/history?symbol=${testSymbol}&interval=1d`,
        status: historyV2Response.status,
        statusText: historyV2Response.statusText,
        success: historyV2Response.ok,
        dataReceived: historyV2Data ? 'Yes' : 'No',
        sampleData: historyV2Data ? {
          bodyType: historyV2Data.body?.items ? 'Object with items' : 'Unknown',
          itemCount: historyV2Data.body?.items ? Object.keys(historyV2Data.body.items).length : 0,
          firstKey: historyV2Data.body?.items ? Object.keys(historyV2Data.body.items)[0] : null,
          firstItem: historyV2Data.body?.items ? Object.values(historyV2Data.body.items)[0] : null
        } : null,
        rawResponse: JSON.stringify(historyV2Data).substring(0, 500)
      });
    } catch (error) {
      results.tests.push({
        name: 'History Endpoint (v2)',
        success: false,
        error: error.message
      });
    }

    // Test 4: Check RapidAPI headers
    results.apiConfig = {
      host: RAPIDAPI_HOST,
      keyPresent: RAPIDAPI_KEY ? 'Yes' : 'No',
      keyLength: RAPIDAPI_KEY ? RAPIDAPI_KEY.length : 0,
      keyPrefix: RAPIDAPI_KEY ? RAPIDAPI_KEY.substring(0, 10) + '...' : 'None'
    };

    // Summary
    const successfulTests = results.tests.filter(t => t.success).length;
    results.summary = {
      totalTests: results.tests.length,
      successful: successfulTests,
      failed: results.tests.length - successfulTests,
      allPassed: successfulTests === results.tests.length
    };

    return res.status(200).json(results);

  } catch (error) {
    console.error('Test API error:', error);
    return res.status(500).json({
      error: 'Test failed',
      message: error.message,
      results: results
    });
  }
}
