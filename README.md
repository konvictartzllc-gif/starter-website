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

- Backend: Node.js + Express + SQLite
- Web: Vite-based frontend
- Mobile: native Android app
- Billing: Stripe
- AI: OpenAI
- Email: SMTP
- Telephony: RingCentral integration path

## Local Setup

### 1. Install dependencies

```powershell
npm install
npm --prefix .\server install
npm --prefix .\client install
```

### 2. Configure backend env

Copy the template and fill in real values:

```powershell
Copy-Item .\server\.env.example .\server\.env
code .\server\.env
```

Important current env keys include:

```env
PORT=4000
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

### 3. Run locally

Backend:

```powershell
npm --prefix .\server run start
```

Web client:

```powershell
npm --prefix .\client run dev
```

Useful backend URLs:

- `http://localhost:4000/`
- `http://localhost:4000/health`
- `http://localhost:4000/api/health`
- `http://localhost:4000/api/diagnostics/providers`

## Current Deployment Path

### Backend

Use Render with:

- repo root config: [render.yaml](./render.yaml)
- or service config: [server/render.yaml](./server/render.yaml)

Important:

- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `node src/index.js`

### Frontend

Frontend is intended to live at:

- `https://www.konvict-artz.com`

### Android

Open [android-app/](./android-app/) in Android Studio and build from there.

## Launch Diagnostics

The backend now exposes:

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
  - [server/.env.example](./server/.env.example)
  - [render.yaml](./render.yaml)
  - [server/render.yaml](./server/render.yaml)
  - [server/src/index.js](./server/src/index.js)

## Related Docs

- [DEPLOY_NOW.md](./DEPLOY_NOW.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [TEST_RESULTS.md](./TEST_RESULTS.md)
- [android-app/PLAY_STORE_RELEASE_CHECKLIST.md](./android-app/PLAY_STORE_RELEASE_CHECKLIST.md)
