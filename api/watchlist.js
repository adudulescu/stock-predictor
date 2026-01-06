// api/watchlist.js
// Manage user watchlists with Supabase

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    
    // Get user from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // GET - Fetch user's watchlist
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('watchlists')
        .select('*')
        .eq('user_id', user.id)
        .order('added_at', { ascending: false });
      
      if (error) {
        throw error;
      }
      
      return res.status(200).json({
        success: true,
        watchlist: data
      });
    }

    // POST - Add stock to watchlist
    if (req.method === 'POST') {
      const { symbol, name, price, target, upside } = req.body;
      
      if (!symbol) {
        return res.status(400).json({ error: 'Symbol required' });
      }
      
      const { data, error } = await supabase
        .from('watchlists')
        .insert({
          user_id: user.id,
          symbol: symbol,
          name: name,
          price_when_added: price,
          target_when_added: target,
          upside_when_added: upside
        })
        .select()
        .single();
      
      if (error) {
        // Check for duplicate
        if (error.code === '23505') {
          return res.status(409).json({ 
            error: 'Stock already in watchlist' 
          });
        }
        throw error;
      }
      
      return res.status(201).json({
        success: true,
        message: 'Added to watchlist',
        item: data
      });
    }

    // DELETE - Remove stock from watchlist
    if (req.method === 'DELETE') {
      const { symbol } = req.query;
      
      if (!symbol) {
        return res.status(400).json({ error: 'Symbol required' });
      }
      
      const { error } = await supabase
        .from('watchlists')
        .delete()
        .eq('user_id', user.id)
        .eq('symbol', symbol);
      
      if (error) {
        throw error;
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