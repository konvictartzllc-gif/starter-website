# 🚀 Dex Backend Deployment Guide

## 📋 Pre-Deployment Requirements

1. **Node.js 18+**: Required for production
2. **Render Account**: https://render.com (free tier available)
3. **Database**: SQLite (included, stored in `/data/`)
4. **Environment Variables**: See section below

---

## 🔧 Environment Variables

Add these to Render's Environment Variables panel:

```env
# Server
PORT=4000
NODE_ENV=production

# Auth
JWT_SECRET=your-random-64-character-secret-here-generate-one-now

# Admin Credentials
ADMIN_USERNAME=KonvictArtz
ADMIN_PASSWORD=K0nv1ctArtz2026Launch

# API Origins
CLIENT_ORIGIN=https://www.konvict-artz.com

# Square Payment (Optional - for production)
SQUARE_ENVIRONMENT=production
SQUARE_ACCESS_TOKEN=sq_live_your_token_here
SQUARE_LOCATION_ID=your_location_id

# Dex Pricing
DEX_PRICE_CENTS=999
DEX_CURRENCY=USD

# Email Notifications (Optional but Recommended)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SENDER_EMAIL=noreply@konvict-artz.com
SENDER_NAME=Konvict Artz

# AI Chat (Optional)
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-3.5-turbo
```

⚠️ **Generate JWT Secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📦 Step 1: Create Render Service (Free Tier)

### Option A: From GitHub (Recommended)
1. Push code to GitHub
2. Go to https://dashboard.render.com
3. Click **"New+" → "Web Service"**
4. Connect GitHub repository
5. Choose branch: `main`
6. Name: `konvict-artz-dex-backend`
7. Runtime: `Node`
8. Build Command: `npm install`
9. Start Command: `node src/index.js`
10. Instance Type: **Free** ($0/month)
11. Click **"Create Web Service"**

### Option B: Manual Deployment
1. Go to https://dashboard.render.com
2. Deploy as Docker container or from Git

---

## 🔐 Step 2: Add Environment Variables

In Render dashboard for your service:
1. Go to **Settings → Environment**
2. Add all variables from the `.env.example`
3. Save and **service will auto-redeploy**

---

## 🔗 Step 3: Update Vercel API Proxy

Once Render backend is running, update `vercel.json`:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://YOUR_RENDER_SERVICE.onrender.com/api/:path*"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ]
}
```

Replace `YOUR_RENDER_SERVICE` with your actual Render URL (shown in Render dashboard).

Then redeploy Vercel:
```bash
npx vercel deploy --prod
```

---

## ✅ Step 4: Verify Deployment

### Test Health Endpoint
```bash
curl https://your-render-service.onrender.com/api/health
# Should return: {"ok":true}
```

### Test From Frontend
1. Visit https://www.konvict-artz.com
2. Register a new account
3. Should see "Trial" access granted
4. Click "💬 Start Chat" → Should work

### Test Admin Panel
1. Admin Login at homepage
2. Should be able to promote users to Dex
3. Emails will send if SMTP configured

---

## 🐛 Troubleshooting

### "Cold Start" Takes 30+ seconds on Free Tier
- Normal for Render free tier—service spins down after 15 minutes
- Upgrade to Starter ($8/month) for always-on

### Chat endpoint returns 500
- Check OPENAI_API_KEY in environment
- Falls back to template response if not configured

### Email not sending
- Verify SMTP credentials
- For Gmail: Use **App Password**, not regular password
- Check Render logs: **Logs → stderr**

### Database grows large
- Delete `server/data/konvict_artz.db` to reset
- Render will recreate it on next deploy

---

## 📊 Monitoring

### View Logs
```bash
# In Render dashboard: Logs tab
tail -f /var/log/app.log
```

### Check Database
SSH into Render service and run:
```bash
sqlite3 server/data/konvict_artz.db ".tables"
```

---

## 🔄 Auto-Reup When Idle (Free Tier Issue)

Free tier services sleep after 15 minutes. Add this to `client/app.js`:

```javascript
// Ping backend every 10 minutes to keep it warm
setInterval(() => {
  fetch('/api/health').catch(() => {});
}, 10 * 60 * 1000);
```

---

## 📱 Full Production Checklist

- [ ] Create Render service
- [ ] Add all env variables
- [ ] Test health endpoint
- [ ] Update Vercel `vercel.json` with Render URL
- [ ] Redeploy Vercel
- [ ] Test user registration → trial
- [ ] Test chat endpoint
- [ ] Test admin promoter creation
- [ ] Verify email sends (if configured)
- [ ] Load test with 100+ concurrent users
- [ ] Monitor error rates

---

## 🚀 Quick Deploy Script

```bash
#!/bin/bash
# Deploy to production

# 1. Commit changes
git add -A
git commit -m "Production deployment: Dex implementation complete"
git push origin main

# 2. Render auto-deploys from GitHub
# Monitor: https://dashboard.render.com

# 3. Get Render URL from dashboard, then:
npx vercel env add API_BACKEND_URL
# Enter: https://your-render-service.onrender.com

# 4. Update vercel.json with the URL
# 5. Redeploy Vercel
npx vercel deploy --prod

echo "✅ Deployment complete!"
```

---

## 💰 Cost Estimate

### Free Tier
- Render Backend: $0/month (limited)
- Vercel Frontend: $0/month (generous free tier)
- Email: $0 (Gmail SMTP)
- OpenAI: $0.002 - $0.01 per chat (if enabled)
- **Total: $0-5/month**

### Production Tier (Growth)
- Render Backend Starter: $8/month (always-on)
- Vercel Pro: $20/month (advanced features)
- SendGrid Email: $20/month (high volume)
- OpenAI API: Pay as you go ($0.002-$0.05 per request)
- **Total: $50-100/month**

---

## 📞 Support

- Render Issues: https://render.com/docs
- Vercel Issues: https://vercel.com/support
- Local Testing: `npm run start` in project root
