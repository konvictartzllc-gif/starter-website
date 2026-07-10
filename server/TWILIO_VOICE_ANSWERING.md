# Dex Voice Answering Setup

This is the phone-free answering-machine path. Calls must be forwarded to a Twilio number, then Twilio calls Dex webhooks. Android does not answer the live call.

## Environment Variables

Set these on Railway:

```text
PUBLIC_API_URL=https://konvict-artz-backend-production.up.railway.app
TWILIO_VOICE_WEBHOOK_TOKEN=make-a-long-random-secret
DEX_TWILIO_OWNER_EMAIL=your-admin-email@example.com
```

`DEX_TWILIO_OWNER_EMAIL` should match the Dex account that should receive saved call messages.

## Twilio Webhook

In Twilio, set the phone number voice webhook to one of these:

```text
https://konvict-artz-backend-production.up.railway.app/api/twilio/voice?token=YOUR_TOKEN_HERE
```

or, for a user-specific route:

```text
https://konvict-artz-backend-production.up.railway.app/api/twilio/voice?token=YOUR_TOKEN_HERE&route=USER_ROUTE_KEY
```

Use:

```text
HTTP POST
```

## Centralized Routing

Dex now supports shared provider accounts without mixing calls. Assign every user a route from the admin API:

```text
POST /api/admin/integrations/ringcentral/assign
```

Body:

```json
{
  "userId": 123,
  "assignedNumber": "+12055550123",
  "extension": "101",
  "permissions": {
    "answerCalls": true,
    "takeMessages": true,
    "sendSms": false,
    "callBack": false
  }
}
```

Each route receives a unique `routeKey`. Use that `routeKey` in the webhook URL for that user. Dex also tries to resolve calls by the dialed `To`/`Called` phone number or extension if the provider sends those fields.

RingCentral-compatible alias:

```text
https://konvict-artz-backend-production.up.railway.app/api/ringcentral/voice?token=YOUR_TOKEN_HERE&route=USER_ROUTE_KEY
```

## Phone Forwarding

Forward unanswered calls from the real phone to the Twilio number. The phone stays free because Dex answers on the Twilio line.

## Result

Dex will:

1. Answer the forwarded call.
2. Ask for the caller name and message.
3. Save the transcript or recording link into Dex call messages.
4. Show it in the existing communications/call message views.
