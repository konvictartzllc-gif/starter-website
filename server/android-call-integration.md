# Dex Android Phone Integration Spec

## Product Direction

Dex is an AI assistant with user accounts, a 3-day free trial, and a $9.99/month subscription. Android is the first mobile target. iPhone support is planned later.

Dex should:
- connect to the user's Android phone after explicit permission
- monitor incoming call state
- auto-reject spam calls
- allow unknown callers through
- ask the user by voice whether to answer or reject non-spam calls
- draft outbound texts before sending and require approval every time
- use RingCentral to place, reroute, and send SMS
- connect each user to their own private Google Calendar
- keep chat memory for 3 days
- refuse to store sensitive information such as bank details, passwords, or Social Security numbers
- allow users to change Dex's voice

## Current Backend Status

Already present in the web/backend project:
- authenticated Dex API routes
- user accounts and trial access logic
- phone permissions endpoint: `GET/POST /api/dex/permissions`
- call event logging endpoint: `POST /api/dex/call-event`
- recent call events endpoint: `GET /api/dex/call-events`
- per-user preference storage
- paid-only memory enforcement
- sensitive-data refusal for stored memory
- 3-day chat retention enforcement
- database table for private user Google Calendar connections

Still needed on the Android side:
- Android app project
- phone-state listener
- spam detection source
- voice prompt flow for answer/reject confirmation
- contacts access and save-contact prompt
- RingCentral action bridge
- Google OAuth mobile flow

## Android Permissions

Required:
- `READ_PHONE_STATE`
- `READ_CONTACTS`
- `POST_NOTIFICATIONS`
- microphone permission if Dex voice confirmation runs through speech recognition

Likely needed depending on implementation:
- `ANSWER_PHONE_CALLS`
- `CALL_PHONE`
- foreground service permission for reliable call handling

Rules:
- no phone access until the user explicitly enables phone permission in Dex
- no contact access until the user grants contacts permission
- unknown callers may still come through
- spam calls should be rejected automatically

## Auth Model

The Android app must authenticate as the Dex user.

Expected flow:
1. User signs into Dex in the Android app.
2. Android stores the Dex bearer token securely.
3. Android calls Dex backend APIs with `Authorization: Bearer <token>`.

## Call Handling Flow

### Incoming Call

1. Android receives incoming call state.
2. Android resolves caller details:
   - saved contact name if available
   - phone number if available
   - `Unknown caller` if neither is available
3. Android checks local spam classification.
4. If spam:
   - reject automatically
   - optionally POST a call event such as `declined`
   - Dex may announce: `Spam call blocked.`
5. If not spam:
   - let the call through
   - Dex speaks: `Incoming call from <caller>. Do you want me to answer or reject it?`
   - user answers by voice
6. If user says answer:
   - Dex answers the call
   - Dex verifies the caller identity first
7. If user says reject:
   - Dex rejects the call

### Verification Script

Before sharing anything private or routing the call, Dex should verify who is speaking.

Default script:

`Hi, this is Dex, the AI assistant for <user name>. Before I connect or help with anything private, please tell me your name and why you're calling.`

After verification:
- if caller is recognized or approved by the user, Dex can continue
- if caller is not recognized, Dex asks the user whether to save the number after the call

### Save Contact Prompt

For a non-spam number that is not already in contacts:
- after the interaction, Dex asks the user whether to save the number
- Dex should not auto-save unknown numbers without approval

## Call Event API Contract

Android should POST to:

`POST /api/dex/call-event`

Headers:

```http
Authorization: Bearer <user_token>
Content-Type: application/json
```

Body:

```json
{
  "event": "incoming",
  "caller": "+12345551234",
  "timestamp": "2026-04-23T18:30:00Z"
}
```

Supported events right now:
- `incoming`
- `answered`
- `declined`

Expected responses:
- `200 { "success": true }`
- `403` when phone permission is not granted
- `401` when auth is missing or invalid

## SMS Flow

Dex should always draft before sending.

Flow:
1. User asks Dex to send a text.
2. Dex drafts the message.
3. Dex reads the draft aloud or shows it on screen.
4. User approves.
5. Dex sends through RingCentral.

Rules:
- approval is required every time
- contact must exist in the user's contacts
- no auto-send mode for now

## RingCentral Responsibilities

RingCentral is the transport layer for:
- placing calls
- rerouting calls
- sending SMS

Android should not directly invent a second outbound calling system if RingCentral is already connected for the user action.

## Google Calendar

Each user connects their own Google Calendar.

Rules:
- calendar connection is private to the user
- admins cannot view the user's private calendar contents
- Dex should only act on the user's linked calendar
- no shared service calendar model

Backend storage should remain per-user and private.

## Memory Rules

Confirmed product rules:
- chat retention is 3 days
- memory is a paid feature
- Dex must not store:
  - Social Security numbers
  - bank account details
  - card numbers
  - passwords
  - passcodes
- Dex may remember lightweight personal context such as birthdays or preferred contacts
- admins cannot view private user memory

Behavior when sensitive data appears:
- Dex refuses to save it
- Dex warns the user not to share it

## Voice Settings

Users can change Dex's voice.

Current scope:
- voice choice only
- no personality-pack switching yet
- voice options depend on the browser/device voices available

## Subscription Rules

- free trial starts at account creation
- trial length is 3 days
- subscription begins after trial expiration
- monthly only
- Stripe will be the billing provider later

Backend note:
- memory and learned preferences should stay aligned with paid access
- Stripe-specific production wiring is deferred until keys and product IDs are available

## Android Build Checklist

1. Create Android app project and Dex sign-in flow.
2. Add runtime permission onboarding for phone, contacts, notifications, and voice.
3. Implement incoming call listener.
4. Integrate spam detection and auto-reject behavior.
5. Implement Dex voice confirmation for answer/reject.
6. POST call events to Dex backend.
7. Add contact lookup and save-contact prompt.
8. Build draft-and-approve SMS flow with RingCentral.
9. Add private Google Calendar OAuth connection flow.
10. Expose voice selection in Android settings.

## Open Items Deferred

Not blocking the backend/web work right now:
- final logo and brand assets
- final Stripe keys and webhook setup
- iPhone implementation
- final Android package name and signing assets
