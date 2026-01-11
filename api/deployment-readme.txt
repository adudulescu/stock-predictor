# S&P 500 Upside Predictor - Deployment Guide

## File Structure

Your project should have this structure:

```
stock-predictor/
├── index.html
├── api/
│   ├── analyze.js
│   ├── predict.js
│   ├── initialize-data.js
│   └── watchlist.js
├── package.json
└── vercel.json (optional)
```

## Step 1: Supabase Setup

### 1. Create Tables

Run these SQL commands in Supabase SQL Editor:

```sql
-- Stock prices table
CREATE TABLE stock_prices (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  date_utc BIGINT,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC NOT NULL,
  volume BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(symbol, date)
);

CREATE INDEX idx_stock_prices_symbol ON stock_prices(symbol);
CREATE INDEX idx_stock_prices_date ON stock_prices(date);

-- Predictions table
CREATE TABLE predictions (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  prediction_date DATE NOT NULL,
  target_date DATE,
  current_price NUMERIC NOT NULL,
  predicted_price NUMERIC NOT NULL,
  predicted_upside NUMERIC NOT NULL,
  confidence_score NUMERIC,
  technical_score NUMERIC,
  analyst_score NUMERIC,
  sentiment_score NUMERIC,
  technical_data JSONB,
  signals JSONB,
  model_version TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(symbol, prediction_date)
);

CREATE INDEX idx_predictions_symbol ON predictions(symbol);
CREATE INDEX idx_predictions_date ON predictions(prediction_date);

-- User watchlists table
CREATE TABLE user_watchlists (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  price_when_added NUMERIC,
  target_when_added NUMERIC,
  upside_when_added NUMERIC,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

CREATE INDEX idx_watchlists_user ON user_watchlists(user_id);
```

### 2. Enable Authentication

1. Go to Supabase Dashboard → Authentication → Providers
2. Enable Email provider
3. Enable Google OAuth (optional but recommended)

## Step 2: Environment Variables

In Vercel Dashboard → Settings → Environment Variables, add:

```
SUPABASE_URL=https://enidizmtvmzyqcjwrcew.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key_here
```

**Important:** Use the **service_role** key, not the **anon** key, for the backend APIs.

## Step 3: Package.json

Create a `package.json` file:

```json
{
  "name": "stock-predictor",
  "version": "2.0.0",
  "description": "S&P 500 Stock Upside Predictor",
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0"
  }
}
```

## Step 4: Deploy to Vercel

### Option A: Git Deployment (Recommended)

1. Push your code to GitHub
2. Connect repository to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Option B: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY

# Deploy to production
vercel --prod
```

## Step 5: Initialize Historical Data

After deployment:

1. Open your deployed app
2. Click "Initialize Historical Data" button
3. Wait 2-3 minutes for data collection
4. Click "Analyze Top Opportunities"

## Troubleshooting

### "Build Failed" Error

If you see errors about invalid function names:
- Make sure all files in `/api` folder have simple names (no spaces or special chars)
- Valid: `analyze.js`, `predict.js`, `watchlist.js`
- Invalid: `predict-dummy_data.js`, `api predict.js`

### "Unauthorized" Error

- Check that you're using the **service_role** key, not **anon** key
- Verify environment variables are set in Vercel

### "No Data" After Analysis

1. Check Vercel function logs for errors
2. Verify RapidAPI key is working: `58cacb4713mshe9e5eb3e89dad26p12c9d0jsn2113d69535c8`
3. Run "Initialize Historical Data" first

### Rate Limiting

- The app includes 100-200ms delays between API calls
- If you hit rate limits, wait a few minutes and try again

## API Endpoints

Once deployed, you'll have:

- `POST /api/analyze` - Generate predictions for stocks
- `POST /api/predict` - Core prediction engine
- `POST /api/initialize-data` - One-time data collection
- `GET /api/watchlist` - Get user's watchlist
- `POST /api/watchlist` - Add to watchlist
- `DELETE /api/watchlist?symbol=AAPL` - Remove from watchlist

## Testing

Test each endpoint:

```bash
# Test analyze endpoint
curl -X POST https://your-app.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbols":["AAPL","MSFT"],"minUpside":0}'

# Test initialization
curl -X POST https://your-app.vercel.app/api/initialize-data
```

## Support

For issues:
1. Check Vercel deployment logs
2. Check browser console (F12)
3. Verify all environment variables are set
4. Ensure Supabase tables are created correctly
