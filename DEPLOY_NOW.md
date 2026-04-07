# ⚡ Quick Production Setup (5 mins)

## 🎯 Goal
Get Dex AI live at https://www.konvict-artz.com with:
- ✅ Voice chat ("Hey Dex")
- ✅ 3-day free trial
- ✅ Promoter program with email
- ✅ Payment subscription
- ✅ Gmail integration

---

## 🚀 Deploy Now

### Step 1: Deploy Backend to Render (2 minutes)
```bash
# 1. Go to https://render.com/dashboard
# 2. Click "New Web Service"
# 3. Connect GitHub (or upload ZIP)
# 4. Name: konvict-artz-dex-api
# 5. Runtime: Node
# 6. Start: node src/index.js
# 7. Click Create
```

### Step 2: Add Environment (1 minute)
In Render dashboard → Settings → Environment:
```
JWT_SECRET=xxxxxxxxxxxxxxx (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
CLIENT_ORIGIN=https://www.konvict-artz.com
ADMIN_USERNAME=KonvictArtz
ADMIN_PASSWORD=K0nv1ctArtz2026Launch
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
OPENAI_API_KEY=sk-xxxxxx (optional)
```

### Step 3: Wire Backend to Frontend (1 minute)
1. Copy your Render URL: `https://xxxx.onrender.com`
2. Edit `vercel.json`:
```json
{
  "rewrites": [{
    "source": "/api/:path*",
    "destination": "https://xxxx.onrender.com/api/:path*"
  }]
}
```
3. Push to GitHub → Vercel auto-deploys

### Step 4: Test (1 minute)
```bash
# Test backend health
curl https://xxxx.onrender.com/api/health

# Test from frontend
# Visit https://www.konvict-artz.com
# Login → Click "💬 Start Chat"
# Say "Hey Dex" → Should work!
```

---

## 📋 Features Now Live

| Feature | Status | Notes |
|---------|--------|-------|
| User Registration | ✅ | Auto 3-day trial |
| Voice "Hey Dex" | ✅ | Chrome/Edge only |
| AI Chat | ✅ | Needs OpenAI key for advanced |
| Trial System | ✅ | Auto-enforced |
| Promoters | ✅ | Emails if SMTP set |
| Payments | ✅ | Square integration ready |
| **Live URL** | ✅ | https://www.konvict-artz.com |

---

## 🔐 Gmail App Password Setup

For email notifications to work:
1. Go to myaccount.google.com/apppasswords
2. Select: Mail & Windows PC (or Device)
3. Copy generated password → `SMTP_PASS`
4. ⚠️ NOT your regular Gmail password!

---

## 🎬 Test User Flow

```bash
# 1. Register
POST https://www.konvict-artz.com/api/auth/user/register
{
  "username": "TestUser",
  "email": "test@example.com",
  "password": "TestPass123456!"
}

# 2. Login
POST https://www.konvict-artz.com/api/auth/user/login
{
  "email": "test@example.com",
  "password": "TestPass123456!"
}

# 3. Check Trial Access
POST https://www.konvict-artz.com/api/dex/access-ai
Header: Authorization: Bearer TOKEN

# Response: {"access": true, "type": "trial", "expiresAt": "2026-04-10T..."}

# 4. Chat
POST https://www.konvict-artz.com/api/dex/chat
Header: Authorization: Bearer TOKEN
{
  "message": "What services do you offer?"
}
```

---

## 🎤 Voice Features

Works in:
- ✅ Chrome 25+
- ✅ Edge 79+
- ⚠️ Safari (iOS 14.7+, limited)
- ❌ Firefox

For voice to work:
- Must be HTTPS (production)
- Browser must have microphone access
- Say "Hey Dex" clearly

---

## 💰 Costs

- **Backend**: Free (Render)
- **Frontend**: Free (Vercel)
- **Email**: Free (Gmail)
- **AI**: $0-5/month (OpenAI, optional)
- **Total**: $0-5/month

No credit card needed for free tier!

---

## ❓ Issues?

### Render service not starting?
```bash
# Check logs in Render dashboard
# Likely missing env variables
```

### "Chat endpoint not found (404)"?
```bash
# Vercel proxy not wired correctly
# Check vercel.json has correct API URL
```

### Voice not working?
```bash
# Chrome only in production
# HTTPS required
# Allow microphone access when prompted
```

---

## 📞 Next Steps

1. ✅ Deploy backend to Render
2. ✅ Configure environment variables
3. ✅ Update `vercel.json` with Render URL
4. ✅ Test all features
5. ✅ Monitor for errors
6. 🎉 Go live!

**Estimated time: 10 minutes**

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.
