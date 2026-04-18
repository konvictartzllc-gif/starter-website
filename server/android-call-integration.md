# Android Call Event Integration (Stub)

To integrate Dex with Android phone call events:

## 1. Permissions
- User must grant the "phone" permission in the Dex web app (/settings).

## 2. POST Call Events
- Android app should POST to `/api/dex/call-event` with:
  - `event`: "incoming", "answered", or "declined"
  - `caller`: Caller name or number
  - `timestamp`: (optional) ISO string
- Example:

```http
POST /api/dex/call-event
Authorization: Bearer <user_token>
Content-Type: application/json

{
  "event": "incoming",
  "caller": "+12345551234",
  "timestamp": "2026-04-17T12:34:56Z"
}
```

## 3. Result
- Returns `{ success: true }` if logged and permission granted.
- Returns 403 if phone permission not granted.

---

This enables Dex to announce callers, log call events, or trigger automations for Android users.
