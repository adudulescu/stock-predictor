// api/admin-stats.js - Track and display API usage statistics
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

    // First, ensure the table exists
    const { error: tableError } = await supabase
      .from('api_usage_logs')
      .select('id')
      .limit(1);

    // If table doesn't exist, return default data
    if (tableError && tableError.code === '42P01') {
      console.log('api_usage_logs table does not exist yet');
      return res.status(200).json({
        success: true,
        last24Hours: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          rateLimitHits: 0
        },
        dailyLimit: 500,
        remainingRequests: 500,
        percentageUsed: '0.0',
        recentActivity: [],
        message: 'No usage data yet - run your first analysis'
      });
    }

    // Get stats from last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: logs, error: logsError } = await supabase
      .from('api_usage_logs')
      .select('*')
      .gte('timestamp', twentyFourHoursAgo)
      .order('timestamp', { ascending: false });

    if (logsError) {
      throw logsError;
    }

    // Aggregate statistics
    const stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0
    };

    const recentActivity = [];

    if (logs && logs.length > 0) {
      // Sum up all the stats
      logs.forEach(log => {
        stats.totalRequests += log.total_requests || 0;
        stats.successfulRequests += log.successful_requests || 0;
        stats.failedRequests += log.failed_requests || 0;
        stats.rateLimitHits += log.rate_limit_hits || 0;
      });

      // Get recent activity (group by hour)
      const activityMap = {};
      logs.forEach(log => {
        const hour = new Date(log.timestamp).toISOString().slice(0, 13);
        if (!activityMap[hour]) {
          activityMap[hour] = {
            timestamp: log.timestamp,
            requests: 0,
            successful: 0,
            failed: 0,
            rateLimited: 0
          };
        }
        activityMap[hour].requests += log.total_requests || 0;
        activityMap[hour].successful += log.successful_requests || 0;
        activityMap[hour].failed += log.failed_requests || 0;
        activityMap[hour].rateLimited += log.rate_limit_hits || 0;
      });

      Object.values(activityMap)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10)
        .forEach(activity => recentActivity.push(activity));
    }

    const dailyLimit = 500; // RapidAPI free tier limit
    const remainingRequests = Math.max(0, dailyLimit - stats.totalRequests);
    const percentageUsed = ((stats.totalRequests / dailyLimit) * 100).toFixed(1);

    return res.status(200).json({
      success: true,
      last24Hours: stats,
      dailyLimit: dailyLimit,
      remainingRequests: remainingRequests,
      percentageUsed: percentageUsed,
      recentActivity: recentActivity,
      apiProvider: 'yahoo-finance15.p.rapidapi.com'
    });

  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch statistics', 
      message: error.message 
    });
  }
}
