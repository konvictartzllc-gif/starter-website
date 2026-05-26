# Dex Voice Answering Setup

This is the phone-free answering-machine path. Calls must be forwarded to a Twilio number, then Twilio calls Dex webhooks. Android does not answer the live call.

## Environment Variables

Set these on Render:

```text
PUBLIC_API_URL=https://konvict-artz.onrender.com
TWILIO_VOICE_WEBHOOK_TOKEN=make-a-long-random-secret
DEX_TWILIO_OWNER_EMAIL=your-admin-email@example.com
```

`DEX_TWILIO_OWNER_EMAIL` should match the Dex account that should receive saved call messages.

## Twilio Webhook

In Twilio, set the phone number voice webhook to:

```text
https://konvict-artz.onrender.com/api/twilio/voice?token=YOUR_TOKEN_HERE
```

Use:

```text
HTTP POST
```

## Phone Forwarding

Forward unanswered calls from the real phone to the Twilio number. The phone stays free because Dex answers on the Twilio line.

## Result

Dex will:

1. Answer the forwarded call.
2. Ask for the caller name and message.
3. Save the transcript or recording link into Dex call messages.
4. Show it in the existing communications/call message views.
