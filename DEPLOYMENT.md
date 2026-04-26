# Dex Backend Deployment Guide

This is the longer deployment guide for the current Dex backend.

## Pre-deployment checklist

You should have:

- a Render account
- access to your GitHub repo
- Stripe keys and webhook secret
- OpenAI key
- SMTP credentials if you want email features live
- RingCentral credentials if you want live telephony features

## Backend service settings

Create a Render web service with:

- **Name:** `konvict-artz-backend`
- **Environment:** `Node`
- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `node src/index.js`

The Render config files in this repo are:

- [render.yaml](./render.yaml)
- [server/render.yaml](./server/render.yaml)

## Required environment variables

Use [server/.env.example](./server/.env.example) as the source of truth.

At minimum, set:

```env
NODE_ENV=production
PORT=3001
PUBLIC_SITE_URL=https://www.konvict-artz.com
CLIENT_ORIGIN=https://www.konvict-artz.com
ALLOWED_ORIGINS=https://www.konvict-artz.com,https://konvict-artz.com

JWT_SECRET=...
ADMIN_EMAIL=...
ADMIN_PASSWORD=...

AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini

STRIPE_SECRET_KEY=...
STRIPE_PUBLISHABLE_KEY=...
STRIPE_PRICE_ID=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_SUCCESS_URL=https://www.konvict-artz.com/settings?billing=success
STRIPE_CANCEL_URL=https://www.konvict-artz.com/settings?billing=cancelled
STRIPE_PORTAL_RETURN_URL=https://www.konvict-artz.com/settings
```

Recommended if used by your launch flow:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SENDER_EMAIL=...
SENDER_NAME=Konvict Artz

RC_CLIENT_ID=...
RC_CLIENT_SECRET=...
RC_USERNAME=...
RC_PASSWORD=...
RC_PHONE_NUMBER=...
RC_SERVER=https://platform.ringcentral.com
```

## Verify the deployed backend

After deployment, test these routes:

- `https://YOUR_RENDER_URL/`
- `https://YOUR_RENDER_URL/health`
- `https://YOUR_RENDER_URL/api/health`
- `https://YOUR_RENDER_URL/api/diagnostics/providers`

Expected baseline:

- `/` returns backend JSON
- `/health` returns `status: ok`
- diagnostics should reflect the environment variables you actually added

Important:

- a healthy `/health` route confirms deployment and server boot
- `/api/diagnostics/providers` is the deeper config check for auth, AI, billing, email, and phone integrations

## Frontend wiring

Your frontend should send `/api/*` to the deployed backend.

If you use a Vercel rewrite, the destination should look like:

```json
{
  "source": "/api/:path*",
  "destination": "https://YOUR_RENDER_URL/api/:path*"
}
```

## Billing proof

Once health is good, verify the real Stripe flow:

1. create a fresh user
2. confirm the account is on the 3-day trial
3. click subscribe
4. confirm Stripe Checkout opens
5. complete checkout
6. confirm the webhook updates the user to `paid`
7. confirm the billing portal opens

Do not call billing launch-ready until:

- `/api/diagnostics/providers` shows Stripe configured
- register works on the live backend
- login works on the live backend
- checkout session creation works on the live backend

## Diagnostics route

Dex now includes:

- `GET /api/diagnostics/providers`

This helps you confirm:

- AI status
- email status
- RingCentral status
- Stripe config status
- site/origin config
- auth config

## Android testing against production

For the Android companion:

1. build/install from [android-app/](./android-app/)
2. point the app to the live backend URL
3. test login, permissions, caller announce, voice, and billing-related access

## Common pitfalls

- wrong Render service URL
- Render service deployed from the repo root instead of `server`
- old env names like `ADMIN_USERNAME`
- old Square-era env names instead of Stripe keys
- Vercel still pointing `/api/*` at an old backend
- environment variables added to the wrong Render service
- environment variables not saved before redeploy
- assuming `/health` means auth and Stripe are ready

## Current source of truth

If any document disagrees with code, trust these first:

- [server/.env.example](./server/.env.example)
- [render.yaml](./render.yaml)
- [server/render.yaml](./server/render.yaml)
- [server/src/index.js](./server/src/index.js)
- [server/src/routes/payments.js](./server/src/routes/payments.js)
