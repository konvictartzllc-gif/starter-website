# Dex AI Documentation

## Overview
Dex AI is an AI-powered assistant integrated into the Konvict Artz platform. It provides users with:
- Service booking assistance
- Appointment management
- Reminders
- General Q&A about home services

## Key Features
- **Referral & Promoter System**: Users can become promoters and receive unique referral codes. Promoters get free access and can earn rewards for referrals.
- **Access Control**: Users can access Dex AI via free, paid, or trial access. Access is checked on every AI interaction.
- **Payment Integration**: Payments are processed via Square. Successful payments unlock full Dex AI access.
- **OpenAI Integration**: Dex AI uses OpenAI's GPT models for chat responses. If OpenAI is not configured, fallback responses are provided.

## API Endpoints (server/src/routes/dex.js)
- `POST /create-promoter`: Admin-only. Assigns a referral code and promoter status to a user.
- `POST /generate-code`: Admin-only. Generates a unique access code for a user.
- `GET /stats/:code`: Returns referral stats for a given code.
- `POST /access-ai`: Checks if a user has access to Dex AI (free, paid, or trial).
- `POST /pay`: Processes payment and unlocks Dex AI access.
- `POST /chat`: Main chat endpoint. Requires user access. Forwards messages to OpenAI and returns the AI's reply.

## How Dex AI Works
1. **User Access**: Checked via `/access-ai` before chat.
2. **Chat**: User sends a message to `/chat`. If access is valid, the message is sent to OpenAI. The AI's reply is returned.
3. **Promoter Earnings**: When a referred user pays, the promoter earns a reward.

## Environment Variables
- `OPENAI_API_KEY`: OpenAI API key for chat.
- `OPENAI_MODEL`: (optional) Model to use (default: gpt-3.5-turbo).
- `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`: For payment processing.
- `DEX_PRICE_CENTS`, `DEX_CURRENCY`: Payment amount and currency.
- `CLIENT_ORIGIN`: Base URL for referral links.

## File Reference
- **Backend**: `server/src/routes/dex.js` (main logic), `server/src/middleware/auth.js` (auth), `server/src/email.js` (notifications)
- **Frontend**: `client/` (UI, API calls)

---
This document summarizes all Dex AI logic and endpoints as of April 2026.
