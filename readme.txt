# 📈 S&P 500 Upside Predictor - Full Stack

## 🚀 Quick Setup

### 1. Create Folder Structure
```bash
mkdir stock-predictor
cd stock-predictor
mkdir api
mkdir public
```

### 2. Add Files
Download all artifacts and place them:
- `vercel.json` → root folder
- `package.json` → root folder
- `api/analyze.js` → api folder
- `api/watchlist.js` → api folder
- `public/index.html` → public folder

### 3. Install Dependencies
```bash
npm install
```

### 4. Setup Supabase (Free Database)

1. Go to [supabase.com](https://supabase.com)
2. Create new project
3. In SQL Editor, run this:

```sql
-- Watchlists table
CREATE TABLE watchlists (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  symbol VARCHAR(10) NOT NULL,
  name VARCHAR(255),
  price_when_added DECIMAL(10,2),
  target_when_added DECIMAL(10,2),
  upside_when_added DECIMAL(5,2),
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

-- Analysis history
CREATE TABLE analysis_history (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  price DECIMAL(10,2),
  target DECIMAL(10,2),
  upside DECIMAL(5,2),
  signals JSONB,
  analyzed_at TIMESTAMP DEFAULT NOW()
);

-- Enable security
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own watchlist" 
  ON watchlists FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlist" 
  ON watchlists FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlist" 
  ON watchlists FOR DELETE 
  USING (auth.uid() = user_id);
```

4. Enable Google Auth:
   - Settings → Authentication → Providers
   - Enable Google
   - Add your domain

5. Copy your credentials:
   - Settings → API
   - Copy URL and anon key

### 5. Update public/index.html

Replace these lines:
```javascript
const supabase = window.supabase.createClient(
    'YOUR_SUPABASE_URL',     // Paste your Supabase URL
    'YOUR_SUPABASE_ANON_KEY' // Paste your anon key
);
```

### 6. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel
```

When prompted for environment variables, add:
- `RAPIDAPI_KEY` = your RapidAPI key
- `SUPABASE_URL` = your Supabase URL
- `SUPABASE_KEY` = your Supabase anon key

### 7. Done! 🎉

Your app is now live at: `your-project.vercel.app`

## 🔧 Environment Variables

Add these in Vercel Dashboard → Settings → Environment Variables:

```
RAPIDAPI_KEY=your_rapidapi_key_from_rapidapi.com
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=your_supabase_anon_key
```

## 📱 Features

✅ User authentication (Google + Email)
✅ Personal watchlists
✅ Stock analysis with AI predictions
✅ 30-day upside predictions
✅ Analyst ratings & targets
✅ Database storage
✅ Mobile responsive

## 💰 Cost

**$0/month** with free tiers:
- Vercel: Free forever
- Supabase: 500MB database free
- RapidAPI: 500 calls/month free

## 🆘 Troubleshooting

### API not working?
- Check environment variables in Vercel
- Verify RapidAPI subscription is active

### Database errors?
- Run SQL setup in Supabase
- Check Row Level Security policies

### Can't sign in?
- Enable Google Auth in Supabase
- Add your domain to allowed URLs

## 📞 Support

For issues, check:
1. Browser console for errors (F12)
2. Vercel deployment logs
3. Supabase logs

## 🎯 Next Steps

- Add email alerts
- Add portfolio tracking
- Add stock price charts
- Add social features