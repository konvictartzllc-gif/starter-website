# Dex Test Results

This file is now a current-state summary, not the older Square-era launch note.

## What has been verified recently

### Backend

- signup works locally
- login works locally
- trial users are created correctly
- `/health` works locally
- `/api/health` works locally
- `/api/diagnostics/providers` works locally

### Live backend

Verified on Render:

- `https://konvict-artz.onrender.com/health` works
- the current live backend URL is `https://konvict-artz.onrender.com`
- the deployed service is the Dex backend, not the wrong app

Not yet verified on Render:

- signup
- login
- Stripe checkout
- webhook-driven paid upgrade flow

### Diagnostics status

Latest local diagnostics showed:

- AI: `ok`
- Email: `ok`
- Stripe: `ok`
- RingCentral: `network_error`

That means:

- core config is in much better shape
- Stripe keys are present
- email config is present
- RingCentral is still the provider that needs follow-up in a real deployed environment

Latest live diagnostics showed:

- health is green
- Render environment variables are still missing from the running service
- JWT/admin/site/Stripe/OpenAI values are not yet visible to the live process

That means the live backend can boot but still fail on signup, login, and billing.

### Billing path

What has been proven locally:

- new user signup
- trial access resolution
- billing status route
- checkout route reaches Stripe code path

What still needs live environment proof from the deployed backend:

- Stripe Checkout opening from the deployed backend
- webhook reaching `/api/payments/webhook`
- user flipping from `trial` to `paid`
- billing portal end-to-end

### Android

Verified in project/build flow:

- Android project exists and builds
- Dex voice test works
- caller announce works
- answer command works after timing fix
- direct call placement works better with saved contact names

Still best treated as final-device validation items:

- long background reliability
- live permissions flow across different phones
- production backend connectivity from phone

## Current launch blockers

1. Render environment variables must be present in the live `konvict-artz.onrender.com` service
2. live Stripe payment proof still needs to be completed
3. RingCentral live connectivity still needs follow-up

## Current source of truth

When in doubt, trust:

- [README.md](./README.md)
- [DEPLOY_NOW.md](./DEPLOY_NOW.md)
- [render.yaml](./render.yaml)
- [server/render.yaml](./server/render.yaml)
- [server/.env.example](./server/.env.example)
