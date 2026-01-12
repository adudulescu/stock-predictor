// api/admin-stats.js - Get API usage statistics
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Get usage from last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: usageLogs, error } = await supabase
      .from('api_usage_logs')
      .select('*')
      .gte('timestamp', twentyFourHoursAgo)
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Database error:', error);
      // Return empty data if table doesn't exist yet
      return res.status(200).json({
        success: true,
        last24Hours: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          rateLimitHits: 0
        },
        dailyLimit: 500, // RapidAPI free tier typically 500/day
        remainingRequests: 500,
        percentageUsed: 0,
        recentActivity: []
      });
    }

    // Calculate totals
    const totals = usageLogs.reduce((acc, log) => ({
      totalRequests: acc.totalRequests + (log.total_requests || 0),
      successfulRequests: acc.successfulRequests + (log.successful_requests || 0),
      failedRequests: acc.failedRequests + (log.failed_requests || 0),
      rateLimitHits: acc.rateLimitHits + (log.rate_limit_hits || 0)
    }), {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0
    });

    // RapidAPI limits (adjust based on your plan)
    const dailyLimit = 500; // Free tier
    const remainingRequests = Math.max(0, dailyLimit - totals.totalRequests);
    const percentageUsed = Math.min(100, (totals.totalRequests / dailyLimit) * 100);

    // Get hourly breakdown for chart
    const hourlyData = {};
    usageLogs.forEach(log => {
      const hour = new Date(log.timestamp).getHours();
      if (!hourlyData[hour]) {
        hourlyData[hour] = { requests: 0, errors: 0 };
      }
      hourlyData[hour].requests += log.total_requests || 0;
      hourlyData[hour].errors += log.failed_requests || 0;
    });

    return res.status(200).json({
      success: true,
      last24Hours: totals,
      dailyLimit: dailyLimit,
      remainingRequests: remainingRequests,
      percentageUsed: percentageUsed.toFixed(1),
      recentActivity: usageLogs.slice(0, 10).map(log => ({
        timestamp: log.timestamp,
        requests: log.total_requests,
        successful: log.successful_requests,
        failed: log.failed_requests,
        rateLimited: log.rate_limit_hits
      })),
      hourlyBreakdown: hourlyData,
      apiProvider: 'yahoo-finance15.p.rapidapi.com',
      estimatedCost: (totals.totalRequests * 0.001).toFixed(2) // Estimate $0.001 per request
    });

  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch stats', 
      message: error.message 
    });
  }
}
