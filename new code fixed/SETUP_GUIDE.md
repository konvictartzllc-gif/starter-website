# Konvict Artz — Dex AI Platform Setup Guide

**Domain:** https://www.konvict-artz.com
**Frontend:** Vercel | **Backend:** Render

---

## What's Been Built

| Feature | Status |
|---|---|
| "Hey Dex" wake word — no clicking required | ✅ Built |
| Human-like AI personality with memory | ✅ Built |
| 3-day free trial → $9.99/month subscription | ✅ Built |
| Square payment integration | ✅ Built |
| Admin portal (password protected) | ✅ Built |
| Affiliate system with unique promo codes | ✅ Built |
| $2/subscriber affiliate commission tracking | ✅ Built |
| Affiliate dashboard | ✅ Built |
| Emergency detection → auto call to 205-749-2403 | ✅ Built |
| Low inventory SMS alerts to 205-623-9541 | ✅ Built |
| Persistent chat memory per user | ✅ Built |
| Appointment booking via Dex | ✅ Built |
| Email notifications (welcome, promo, subscription) | ✅ Built |
| Rate limiting & security headers | ✅ Built |
| Vercel + Render deployment configs | ✅ Built |

---

## Step 1: Get Your API Keys

You will need accounts and keys for the following services:

### OpenAI (for Dex AI brain)
1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Save it as `OPENAI_API_KEY`

### Square (for payments — you already have this)
1. Go to https://developer.squareup.com/apps
2. Find your app and copy:
   - **Access Token** → `SQUARE_ACCESS_TOKEN`
   - **Location ID** → `SQUARE_LOCATION_ID`
3. Set `SQUARE_ENV=production` for live payments

### Twilio (for calls and SMS)
1. Go to https://www.twilio.com and create an account
2. Get a phone number (~$1/month)
3. Copy from your dashboard:
   - **Account SID** → `TWILIO_ACCOUNT_SID`
   - **Auth Token** → `TWILIO_AUTH_TOKEN`
   - **Phone Number** → `TWILIO_PHONE_NUMBER` (format: +12055551234)

### Email (Gmail recommended)
1. Use your Gmail account
2. Enable 2FA and create an **App Password** at https://myaccount.google.com/apppasswords
3. Set:
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=587`
   - `SMTP_USER=your@gmail.com`
   - `SMTP_PASS=your_16_char_app_password`

---

## Step 2: Deploy the Backend to Render

1. Push the `server/` folder to a GitHub repository
2. Go to https://render.com → **New Web Service**
3. Connect your GitHub repo
4. Set **Build Command:** `npm install`
5. Set **Start Command:** `node src/index.js`
6. Add all environment variables from the table below:

### Required Environment Variables (Render)

| Variable | Value |
|---|---|
| `PORT` | `3001` |
| `CLIENT_ORIGIN` | `https://www.konvict-artz.com` |
| `JWT_SECRET` | Any long random string (e.g. 64 random chars) |
| `DB_PATH` | `/opt/render/project/src/data/konvict.db` |
| `ADMIN_EMAIL` | Your admin email (e.g. `you@gmail.com`) |
| `ADMIN_PASSWORD` | Your chosen admin password |
| `OPENAI_API_KEY` | From OpenAI |
| `OPENAI_MODEL` | `gpt-4.1-mini` |
| `SQUARE_ACCESS_TOKEN` | From Square |
| `SQUARE_LOCATION_ID` | From Square |
| `SQUARE_ENV` | `production` |
| `DEX_PRICE_CENTS` | `999` |
| `DEX_CURRENCY` | `USD` |
| `TWILIO_ACCOUNT_SID` | From Twilio |
| `TWILIO_AUTH_TOKEN` | From Twilio |
| `TWILIO_PHONE_NUMBER` | Your Twilio number (e.g. `+12055551234`) |
| `EMERGENCY_PHONE` | `2057492403` |
| `ADMIN_PHONE` | `2056239541` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Your Gmail address |
| `SMTP_PASS` | Your Gmail App Password |
| `SENDER_NAME` | `Konvict Artz` |
| `SENDER_EMAIL` | Your Gmail address |

7. After deploy, note your Render URL (e.g. `https://konvict-artz-backend.onrender.com`)

---

## Step 3: Deploy the Frontend to Vercel

1. Push the `client/` folder to a GitHub repository
2. Go to https://vercel.com → **New Project** → Import your repo
3. **Framework:** Vite
4. **Build Command:** `npm run build`
5. **Output Directory:** `dist`
6. Add environment variable:
   - `VITE_API_URL` = `https://your-render-backend.onrender.com/api`
7. Update `client/vercel.json` — replace `your-render-backend.onrender.com` with your actual Render URL
8. Connect your domain `konvict-artz.com` in Vercel's domain settings

---

## Step 4: First Login to Admin Portal

1. Go to `https://www.konvict-artz.com/admin`
2. Log in with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you set in Render
3. From the admin portal you can:
   - View all users and revenue
   - Add/edit/delete inventory
   - Create affiliates (they get a promo code emailed to them automatically)
   - Send promo codes to anyone
   - See low inventory alerts

---

## Step 5: Add Your First Affiliate

1. Go to Admin Portal → **Affiliates** tab
2. Enter the affiliate's email and name
3. Click **Create Affiliate**
4. They will automatically receive an email with their promo code and referral link
5. Every time someone subscribes using their code, they earn $2 (tracked in the dashboard)

---

## How "Hey Dex" Works

When a visitor comes to your site:
1. The browser asks for microphone permission (one time)
2. Dex listens in the background for "Hey Dex"
3. When heard, the chat window opens automatically and Dex says "Hey! I'm listening"
4. The user speaks their request
5. Dex responds with voice AND text

No clicking required at all.

---

## Emergency System

If any user says something like "I want to hurt myself" or "I'm going to hurt someone":
1. Dex immediately responds with a supportive message and the 988 crisis line
2. An automated call is placed to **205-749-2403**
3. An SMS alert is sent to **205-623-9541**

---

## Low Inventory Alerts

- Every hour, the server checks inventory levels
- If any item is at or below its threshold, an SMS is sent to **205-623-9541**
- You can also manually check from Admin Portal → Stats tab

---

## Project Structure

```
konvict-artz/
├── server/                    ← Deploy to Render
│   ├── src/
│   │   ├── index.js           ← Main server entry
│   │   ├── db.js              ← Database (SQLite)
│   │   ├── middleware/
│   │   │   └── auth.js        ← JWT authentication
│   │   ├── routes/
│   │   │   ├── auth.js        ← Register / Login
│   │   │   ├── dex.js         ← Dex AI chat + memory
│   │   │   ├── payments.js    ← Square subscriptions
│   │   │   ├── admin.js       ← Admin portal API
│   │   │   └── affiliate.js   ← Affiliate dashboard API
│   │   └── services/
│   │       ├── twilio.js      ← Calls, SMS, emergency alerts
│   │       └── email.js       ← Email notifications
│   ├── .env.example           ← Copy to .env and fill in
│   └── render.yaml            ← Render deployment config
│
└── client/                    ← Deploy to Vercel
    ├── src/
    │   ├── App.jsx            ← Main app with routing
    │   ├── components/
    │   │   └── DexChat.jsx    ← The Dex AI chat widget
    │   ├── hooks/
    │   │   ├── useAuth.jsx     ← Auth context
    │   │   └── useDexVoice.js ← Wake word + voice
    │   ├── pages/
    │   │   ├── Home.jsx       ← Main landing page
    │   │   ├── Auth.jsx       ← Register + Login
    │   │   ├── AdminPortal.jsx
    │   │   └── AffiliateDashboard.jsx
    │   └── utils/
    │       └── api.js         ← All API calls
    └── vercel.json            ← Vercel deployment config
```
