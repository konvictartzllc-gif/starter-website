# Konvict Artz - Dex AI Assistant Platform

**Full-stack SaaS platform** with voice-activated AI assistant, trial management, subscription payments, and promoter program.

## ✨ Features

### 🎤 Dex AI Voice Assistant
- **Voice Activation**: Say "Hey Dex" to trigger chat
- **Speech Recognition**: Browser-based Web Speech API (Chrome, Edge, Safari)
- **Text-to-Speech**: AI responses read aloud
- **Smart Fallback**: Works without OpenAI key with template responses

### 💳 Trial & Subscription System
- **3-Day Free Trial**: Auto-assigned on registration
- **Trial Enforcement**: Access check at `/api/dex/access-ai`
- **Square Payments**: One-click subscription ($9.99/month default)
- **Access Tiers**: Trial, Paid, and Promoter (free unlimited)

### 👥 Promoter Program
- **Admin Control**: Promote users to promoters with single endpoint
- **Email Notifications**: Welcome email with referral code
- **Referral Tracking**: Automatic stats collection
- **Free Access**: Promoters get unlimited Dex access
- **Referral Benefits**: Referred friends get 3-day trial

### 🏠 Services Integration
- **Booking Management**: Track home services appointments
- **Smart Recommendations**: AI suggests relevant services
- **Appointment Reminders**: Automated scheduling (backend ready)
- **Service History**: Users see their booking timeline

## 🚀 Quick Start

### 1. Install Dependencies
```powershell
npm install
npm --prefix .\server install
```

### 2. Configure Environment
```powershell
# Copy template
Copy-Item .\server\.env.example .\server\.env

# Edit with your config
code .\server\.env
```

Set these variables:
```env
PORT=4000
CLIENT_ORIGIN=http://localhost:4000
JWT_SECRET=your-64-char-random-secret-here
ADMIN_USERNAME=KonvictArtz
ADMIN_PASSWORD=K0nv1ctArtz2026Launch

# Optional: Email notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Optional: AI Chat
OPENAI_API_KEY=sk-your-key-here

# Optional: Payments
SQUARE_ENVIRONMENT=sandbox
SQUARE_ACCESS_TOKEN=...
SQUARE_LOCATION_ID=...
```

### 3. Run Locally
```powershell
npm run start      # Production mode
npm run dev        # Watch mode
```

Open `http://localhost:4000`

## 🧪 Test Features

### Test Trial System
```bash
# Register new user (auto gets 3-day trial)
curl -X POST http://localhost:4000/api/auth/user/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "TestUser",
    "email": "test@example.com",
    "password": "TestPass123456!"
  }'

# Check access (should show trial with expiration)
curl -X POST http://localhost:4000/api/dex/access-ai \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test Chat Endpoint
```bash
curl -X POST http://localhost:4000/api/dex/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What services do you offer?"}'
```

### Test Promoter System
```bash
# Admin login
curl -X POST http://localhost:4000/api/auth/login \
  -d '{"username":"KonvictArtz","password":"K0nv1ctArtz2026Launch"}'

# Create promoter (sends email if SMTP configured)
curl -X POST http://localhost:4000/api/dex/create-promoter \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"email":"promoter@example.com"}'
```

## 📡 API Endpoints

### Authentication
- `POST /api/auth/login` - Admin login
- `POST /api/auth/user/register` - User signup
- `POST /api/auth/user/login` - User login

### Dex Features
- `POST /api/dex/access-ai` - Check trial/paid/promoter access
- `POST /api/dex/chat` - Send message to AI
- `POST /api/dex/create-promoter` - Make user a promoter (admin only)
- `GET /api/dex/stats/:code` - Get referral statistics

### User Profile
- `GET /api/user/me` - Current user profile
- `GET /api/user/bookings` - User's service bookings

## 🌍 Deployment

### Deploy Frontend (Vercel)
Frontend is already deployed to Vercel at https://www.konvict-artz.com

### Deploy Backend (Render)

**5-minute setup:**

1. Go to https://render.com/dashboard
2. **New Web Service**
3. Connect GitHub or upload code
4. Start command: `node src/index.js`
5. Add environment variables (see below)
6. Deploy

**Environment Variables** (Render Settings):
```env
JWT_SECRET=your-secret
CLIENT_ORIGIN=https://www.konvict-artz.com
ADMIN_USERNAME=KonvictArtz
ADMIN_PASSWORD=K0nv1ctArtz2026Launch
OPENAI_API_KEY=sk-your-key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Wire Backend to Frontend

Edit `vercel.json`:
```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://xxxx.onrender.com/api/:path*"
    }
  ]
}
```

Replace with your Render URL, then push → Vercel redeploys.

See [DEPLOY_NOW.md](./DEPLOY_NOW.md) for quick 5-minute setup.
See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed production guide.

## 📱 Voice Features

### Supported Browsers
- ✅ Chrome 25+
- ✅ Edge 79+
- ⚠️ Safari 14.7+ (iOS only)
- ❌ Firefox

### How It Works
1. Click "💬 Start Chat" button
2. Say "Hey Dex" clearly
3. Microphone icon pulses red while listening
4. Speak your command (e.g., "book a plumber")
5. AI responds and reads aloud
6. Ready for next command

## 🎯 User Journey

```
User Visit
    ↓
Sign Up (gets 3-day trial)
    ↓
Click "Start Chat"
    ↓
Say "Hey Dex"
    ↓
Chat with AI / Ask about services
    ↓
(After 3 days)
    ↓
Subscribe ($9.99/mo) OR
Get referred by promoter (free)
```

## 👥 Promoter Journey

```
You promote a user
    ↓
Admin creates promoter
    ↓
Promoter gets email with code
    ↓
Promoter shares referral link
    ↓
Friends sign up with code
    ↓
Friends get 3-day trial
    ↓
Friends can subscribe OR
Promoter stays free forever
```

## 💰 Costs

| Component | Free Tier | Production |
|-----------|-----------|-----------|
| Frontend (Vercel) | ✅ Included | $20/mo |
| Backend (Render) | ✅ Included | $8/mo |
| Email (Gmail) | ✅ Included | +$20/mo |
| AI Chat (OpenAI) | Optional | ~$0.01/msg |
| **Total** | **$0** | **$50-60/mo** |

## 📊 Database Schema

### Users
```sql
id, email, username, password_hash,
referral_code, referred_by,
is_promoter, free_access,
referrals_count, paid,
trial_started_at, trial_expires_at
```

### Payments
```sql
id, user_id, square_payment_id,
amount_cents, currency, status,
idempotency_key, created_at
```

### Bookings
```sql
id, user_id, name, phone, email,
service, booking_date, booking_time,
notes, total_price, discounted,
created_at
```

## 🔐 Security

- JWT tokens with 8-hour expiration
- Bcrypt password hashing (12 rounds)
- CORS protection
- Helmet security headers
- Input validation & sanitization
- Admin-only endpoints protected

## 🐛 Troubleshooting

### Chat returns 500
- Check OPENAI_API_KEY is set
- Falls back to template if missing

### Voice not working
- Only works in Chrome/Edge on production (HTTPS)
- Requires microphone permission
- Say "Hey Dex" clearly

### Email not sending
- Gmail requires **App Password** (not regular password)
- Enable 2FA on Gmail account
- Check SMTP credentials in `.env`

### Trial not enforcing
- Check database: `SELECT trial_expires_at FROM users WHERE email=?`
- Access check happens at `/api/dex/access-ai`

## 📚 Documentation

- [DEPLOY_NOW.md](./DEPLOY_NOW.md) - 5-minute production setup
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Detailed deployment guide
- [Server Code](./server/src/) - Backend implementation
- [Client Code](./client/) - Frontend code

## 🤝 Contributing

All features are production-ready and tested locally. To add features:

1. Test locally: `npm run start`
2. Check database migrations in `server/src/db.js`
3. Add endpoints to `server/src/routes/`
4. Update frontend in `client/app.js`
5. Commit & push → Auto-deploys

## 📞 Support

- Local testing: `npm run start`
- Check logs: Terminal output
- Database: `server/data/konvict_artz.db` (SQLite)
- API Health: `http://localhost:4000/api/health`

---

**Ready to go live? See [DEPLOY_NOW.md](./DEPLOY_NOW.md)** 🚀
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
