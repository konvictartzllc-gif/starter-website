# Dex AI Assistant

Dex is a full-stack assistant platform with:

- web app and backend
- Android companion app
- account signup/login
- 3-day trial and Stripe billing
- admin and affiliate access
- voice/chat assistant flows
- phone, reminder, and learning features

This repo has gone through a few product phases, so the safest source of truth is the current code under:

- [server/](./server/)
- [client/](./client/)
- [android-app/](./android-app/)

## Project Layout

- [server/](./server/) - Express backend, auth, billing, admin, Dex APIs
- [client/](./client/) - web frontend
- [android-app/](./android-app/) - Android Studio project for Dex AI Assistant

## Current Stack

- Backend: Cloudflare Worker fetch handler
- Database: Cloudflare D1
- Web: Vite-based frontend served from the same Worker
- Mobile: native Android app
- Billing: Stripe
- AI: OpenAI
- Email: SMTP configuration surfaced through Worker diagnostics
- Telephony: RingCentral/Twilio callback routes exposed by the Worker

## Local Setup

### 1. Install dependencies

```powershell
npm install
npm --prefix .\server install
npm --prefix .\client install
```

### 2. Configure Worker env

For local Worker development:

```powershell
Copy-Item .\.dev.vars.example .\.dev.vars
code .\.dev.vars
```

Important Cloudflare secrets and vars include:

```env
PUBLIC_SITE_URL=https://worker-autumn-cherry-0533.workers.dev
CLIENT_ORIGIN=https://worker-autumn-cherry-0533.workers.dev
ALLOWED_ORIGINS=https://worker-autumn-cherry-0533.workers.dev,https://www.konvict-artz.com,https://konvict-artz.com

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
RC_PHONE_NUMBER=...
RC_SERVER=https://platform.ringcentral.com
```

### 3. Create the D1 database

```powershell
wrangler d1 create dex-production
```

Copy the returned `database_id` into [wrangler.toml](./wrangler.toml).

### 4. Apply the schema

```powershell
wrangler d1 migrations apply dex-production --local
wrangler d1 migrations apply dex-production --remote
```

### 5. Build and run locally

Build the frontend that the Worker serves as static assets:

```powershell
npm --prefix .\client install
npm --prefix .\client run build
```

Run the Worker locally:

```powershell
wrangler dev
```

Useful Worker URLs:

- `http://localhost:8787/health`
- `http://localhost:8787/api/health`
- `http://localhost:8787/api/diagnostics/providers`

## Cloudflare Deployment Path

### Worker

This repository now ships a Worker entry point at [src/index.js](./src/index.js) and D1 schema helpers at [src/db.js](./src/db.js).

Deploy target:

- `worker-autumn-cherry-0533`

Required secrets:

- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASS`
- `RC_CLIENT_ID`
- `RC_CLIENT_SECRET`

Set them with:

```powershell
wrangler secret put JWT_SECRET
wrangler secret put ADMIN_EMAIL
wrangler secret put ADMIN_PASSWORD
...
```

### Frontend

`client/dist` is built with:

```powershell
npm --prefix .\client run build
```

The Worker serves those built assets directly through the `[assets]` section in [wrangler.toml](./wrangler.toml), so `/api/*` and the SPA live on the same domain.

### GitHub Actions

The active deployment workflow is [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml). It:

- installs dependencies
- builds `client/dist`
- applies D1 migrations
- deploys `worker-autumn-cherry-0533`

The two Azure workflows were intentionally retired to stop the disabled-subscription deployment failure that was showing up in Actions.

### Android

Open [android-app/](./android-app/) in Android Studio and build from there.

## Launch Diagnostics

The Worker now exposes:

- `GET /api/diagnostics/providers`

This gives a quick launch-readiness snapshot for:

- AI
- email
- RingCentral
- Stripe
- site/origin config
- auth config

## Notes

- Older docs in this repo used Square naming and older auth fields. The current product uses Stripe and `ADMIN_EMAIL`.
- If a doc conflicts with current code, trust:
  - [wrangler.toml](./wrangler.toml)
  - [.dev.vars.example](./.dev.vars.example)
  - [migrations/0001_initial.sql](./migrations/0001_initial.sql)
  - [src/index.js](./src/index.js)

## Related Docs

- [DEX_MASTER_ROADMAP.md](./DEX_MASTER_ROADMAP.md)
- [LAUNCH_MUST_DO_NOW.md](./LAUNCH_MUST_DO_NOW.md)
- [DEPLOY_NOW.md](./DEPLOY_NOW.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [TEST_RESULTS.md](./TEST_RESULTS.md)
- [android-app/PLAY_STORE_RELEASE_CHECKLIST.md](./android-app/PLAY_STORE_RELEASE_CHECKLIST.md)
