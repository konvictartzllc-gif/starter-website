# Deploy Dex Now

This is the shortest reliable deployment path for the current Dex stack.

## 1. Backend on Railway

Create a Railway service connected to this GitHub repo with:

- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `node src/index.js`

The Railway config file is:

- [server/railway.toml](./server/railway.toml)

Railway injects `PORT` automatically — do not set it manually.

For SQLite persistence, add a Railway Volume mounted at `/data` and set `DB_PATH=/data/konvict.db`.

## 2. Required Railway environment variables

Set these before testing:

```env
NODE_ENV=production
PUBLIC_SITE_URL=https://www.konvict-artz.com
CLIENT_ORIGIN=https://www.konvict-artz.com
ALLOWED_ORIGINS=https://www.konvict-artz.com,https://konvict-artz.com

DB_PATH=/data/konvict.db

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

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SENDER_EMAIL=...
SENDER_NAME=Konvict Artz

RC_CLIENT_ID=...
RC_CLIENT_SECRET=...
RC_JWT=...
RC_PHONE_NUMBER=...
RC_SERVER=https://platform.ringcentral.com
ADMIN_PHONE=...
EMERGENCY_PHONE=...
```

## 3. Verify backend deployment

Once deployed, test:

- `https://YOUR_RAILWAY_URL/`
- `https://YOUR_RAILWAY_URL/health`
- `https://YOUR_RAILWAY_URL/api/health`
- `https://YOUR_RAILWAY_URL/api/diagnostics/providers`

What you want to see:

- root route returns JSON
- health returns `status: ok`
- diagnostics shows the env you expect as configured

Do not stop at `/health`.

If `/health` works but `/api/diagnostics/providers` shows missing config, the app can still fail at:

- signup
- login
- Stripe checkout
- email or phone features

## 4. Frontend wiring

Update `client/vercel.json` to point `/api/*` to the deployed Railway backend URL:

```json
{
  "source": "/api/:path*",
  "destination": "https://YOUR_RAILWAY_URL/api/:path*"
}
```

## 5. Payment proof

Once backend health is good and diagnostics no longer show missing core config:

1. create a fresh user
2. confirm trial access
3. click upgrade / subscribe
4. confirm Stripe Checkout opens
5. complete checkout
6. confirm account changes to `paid`
7. open billing portal

If signup or login fails on live, check `/api/diagnostics/providers` before anything else.
That route is the fastest way to spot missing Railway environment variables.

## 6. Android

For Android testing:

1. open [android-app/](./android-app/) in Android Studio
2. build/install on your phone
3. point it to the live Railway backend URL
4. test login, permissions, voice, and call flows

## 7. Reality check

If something disagrees with older docs, trust the current files:

- [server/.env.example](./server/.env.example)
- [server/railway.toml](./server/railway.toml)
- [server/src/index.js](./server/src/index.js)

Current deployment platform: **Railway**
