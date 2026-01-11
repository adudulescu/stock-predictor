// api/watchlist.js - User watchlist management
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get auth token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Verify token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // GET - Fetch user's watchlist
    if (req.method === 'GET') {
      const { data: watchlist, error } = await supabase
        .from('user_watchlists')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return res.status(200).json({
        success: true,
        watchlist: watchlist || []
      });
    }

    // POST - Add to watchlist
    if (req.method === 'POST') {
      const { symbol, name, price, target, upside } = req.body;

      if (!symbol) {
        return res.status(400).json({ error: 'Symbol required' });
      }

      const { data, error } = await supabase
        .from('user_watchlists')
        .insert([{
          user_id: user.id,
          symbol: symbol,
          name: name || symbol,
          price_when_added: price,
          target_when_added: target,
          upside_when_added: upside
        }])
        .select();

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          return res.status(409).json({ error: 'Stock already in watchlist' });
        }
        throw new Error(error.message);
      }

      return res.status(200).json({
        success: true,
        watchlist_item: data[0]
      });
    }

    // DELETE - Remove from watchlist
    if (req.method === 'DELETE') {
      const { symbol } = req.query;

      if (!symbol) {
        return res.status(400).json({ error: 'Symbol required' });
      }

      const { error } = await supabase
        .from('user_watchlists')
        .delete()
        .eq('user_id', user.id)
        .eq('symbol', symbol);

      if (error) {
        throw new Error(error.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Removed from watchlist'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Watchlist error:', error);
    return res.status(500).json({ 
      error: 'Operation failed', 
      message: error.message 
    });
  }
}
