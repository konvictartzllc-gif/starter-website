# Konvict Artz

Full-stack starter for Konvict Artz with:
- Express API
- SQLite persistence
- JWT admin authentication
- Vanilla frontend connected to backend routes

## 1. Install

```powershell
npm --prefix .\server install
```

## 2. Configure environment

Copy `server/.env.example` to `server/.env` and set values:

- `PORT` (default `4000`)
- `CLIENT_ORIGIN` (usually `http://localhost:4000`)
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SQUARE_ENVIRONMENT` (`sandbox` or `production`)
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_LOCATION_ID`
- `DEX_PRICE_CENTS` (default `1000`)
- `DEX_CURRENCY` (default `USD`)

## 3. Run

```powershell
npm run dev
```

Open `http://localhost:4000`.

## Vercel Go-Live (Frontend) + Backend API

Use Vercel for the frontend and host the API backend separately (Render/Railway/Fly.io). SQLite write workloads are not suitable for Vercel serverless filesystem.

1. Deploy backend first and confirm API base URL (example: `https://api.konvictartz.com`).
2. Set backend env vars: `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `CLIENT_ORIGIN`, `SQUARE_*`, and persistent `DB_PATH`.
3. Update `vercel.json` and replace `https://REPLACE_WITH_BACKEND_DOMAIN` with your live backend domain.
4. (Optional) Set `<meta name="api-base-url" ...>` in `client/index.html` for explicit API origin. If left blank, `/api` proxy from `vercel.json` is used.
5. Deploy this repo to Vercel.
6. Verify production endpoints from browser:
	- Sign up/login
	- Dex install prompt on desktop/mobile
	- Referral link + stats
	- Booking request + discount response
	- Admin login + booking visibility

## API Summary

Public:
- `GET /api/products`
- `GET /api/reviews`
- `GET /api/works`
- `GET /api/deals`
- `POST /api/reviews`
- `POST /api/bookings`

Admin (Bearer token from login):
- `POST /api/admin/products`
- `DELETE /api/admin/products/:id`
- `POST /api/admin/works`
- `DELETE /api/admin/works/:id`
- `POST /api/admin/deals`
- `DELETE /api/admin/deals/:id`
- `DELETE /api/admin/reviews/:id`
- `GET /api/admin/bookings`
- `DELETE /api/admin/bookings/:id`
- `DELETE /api/admin/clear-all`

Auth:
- `POST /api/auth/login`
- `POST /api/auth/user/register` (supports optional `ref` referral code)
- `POST /api/auth/user/login`

Dex:
- `POST /api/dex/create-promoter` (admin only)
- `GET /api/dex/stats/:code`
- `POST /api/dex/access-ai` (user token)
- `POST /api/dex/pay` (user token + Square source token)

User:
- `GET /api/user/me`
- `GET /api/user/bookings`

## Notes

- This project uses server-side auth and storage, not browser localStorage for business data.
- Do not use demo credentials in production.
- Update Dex download links in `client/app.js` under `DEX_LINKS` before launch.
