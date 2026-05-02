# Dex Master Roadmap

Dex is no longer just a chat feature or a phone helper. The target product is a full assistant that can:

- answer questions
- help with calls and texts
- open apps and guide device actions
- manage plans, routines, money, learning, and reminders
- assist with email and social actions
- detect distress and use a safe emergency flow
- work as much as Android allows outside the app

This document is the source of truth for how we build toward that vision without losing stability.

## Product Vision

Dex should feel like:

- a personal assistant
- a phone companion
- a planner and learning coach
- a communication helper
- a calm support system

Dex should not feel like:

- a test harness
- a settings dump
- a collection of unrelated features

## Product Pillars

### 1. Core Assistant

Dex should be able to:

- answer normal questions
- remember context
- keep chat history
- speak naturally
- open apps and route actions

### 2. Life Management

Dex should help users:

- plan their day
- build routines
- build diet plans
- build workout plans
- build budget plans
- build prayer plans
- manage reminders

### 3. Learning

Dex should support:

- language learning
- lessons
- quizzes
- learning preferences
- reminder-based learning

### 4. Communication

Dex should help with:

- calls
- texts
- emails
- contact memory
- affiliate/admin communication tools
- later: Messenger and social posting workflows

### 5. Emotional Support And Safety

Dex should:

- detect distress language
- respond with comfort and grounding
- handle self-harm or violence risk with a protected emergency flow
- only perform emergency outreach with explicit setup and clear safeguards

### 6. Outside-The-App Assistant

Dex should work beyond the open app through:

- foreground service
- notifications
- full-screen assistant surfaces where appropriate
- Samsung/Android background setup guidance

## Build Strategy

We should not chase every feature at once. Build in layers.

### Phase 1. Product Foundation

Goal:

- make Dex feel like a real product instead of a debug/testing surface

Deliverables:

- clean login/signup flow
- affiliate invite code path
- role-aware dashboards for user, affiliate, admin
- easier home customization
- cleaner dashboard sections
- subscription visibility and purchase path

Status:

- mostly in progress
- core pieces already exist
- still needs polish and consistency

### Phase 2. Core Assistant Reliability

Goal:

- make Dex consistently useful for normal assistant tasks

Deliverables:

- stronger question answering
- cleaner context handling
- chat history UI
- app-launch intents
- better voice command routing before AI fallback
- better transcript recovery for dropped wake-command words

Current priority:

- high

### Phase 3. Life Assistant Layer

Goal:

- make Dex useful every day even when the user is not making calls

Deliverables:

- daily plan builder
- diet plan builder
- workout planner
- budget planner
- prayer/routine sections
- user-created custom sections
- reorderable and renameable dashboard sections

Status:

- started
- needs richer section content and persistence strategy

### Phase 4. Learning System

Goal:

- turn Dex into a real learning assistant

Deliverables:

- visible learning dashboard
- lesson history
- quiz history
- saved preferences
- reminder flow
- language-specific progression

Status:

- partial backend and Android support exists
- needs fuller product UI

### Phase 5. Communication Assistant

Goal:

- make Dex truly useful for calls, texts, and outreach

Deliverables:

- better call control while app is open
- better text compose / read-back / approve / send flows
- better contact alias memory
- email compose and approval flows
- affiliate/admin messaging tools

Status:

- active
- call and text flows exist but still need more polish

### Phase 6. Outside-The-App Experience

Goal:

- make Dex feel present even when the app is closed

Deliverables:

- background access setup flow
- stronger notification actions
- more reliable SMS announcement
- more reliable call prompt behavior
- full-screen incoming assistant prompt if Samsung background handling remains weak

Important note:

- Android and Samsung impose real limits here
- this phase is about reaching the strongest assistant behavior possible without replacing the phone app

### Phase 7. Social And Platform Actions

Goal:

- extend Dex beyond SMS and email into broader communication

Deliverables:

- Facebook post drafting and approval
- Messenger-style workflows where allowed
- social draft review before send
- account-linked publishing actions

Important note:

- this depends on platform API and policy limits
- we should prefer approval-based posting over silent automation

### Phase 8. Emotional Support And Crisis Safety

Goal:

- make Dex supportive, calming, and safe

Deliverables:

- tone detection
- distress detection
- comfort and grounding responses
- crisis configuration flow
- emergency contacts setup
- explicit emergency escalation rules

Hard rule:

- Dex must never improvise dangerous crisis actions
- emergency behavior must be clearly defined and user-configured

### Phase 9. Advanced Device Assistant

Goal:

- make Dex feel close to a system assistant without pretending Android has no limits

Deliverables:

- notification reading
- better app-launch flows
- more guided device actions
- improved background recovery after reboot or process death
- stronger Samsung settings guidance

## Launch Priorities

Before pushing Dex as a serious public product, focus on these:

1. Stable login and subscription flow
2. Reliable core chat
3. Clean call and text experience while app is open
4. Good enough outside-the-app text/call prompting
5. Learning dashboard visibility
6. User dashboard experience
7. Admin and affiliate flows

## Near-Term Execution Order

This is the recommended next build order.

1. Finish the `Background access` setup flow and verify on-device behavior
2. Add a stronger outside-the-app incoming assistant surface
3. Improve app launching and normal assistant commands
4. Add a proper chat history UI
5. Expand the learning dashboard into a fuller experience
6. Add richer user life-planning content blocks
7. Add safer emotional support and emergency setup flows

## Safety Rules

Dex can assist with high-impact actions, but these must be guarded:

- sending messages
- posting publicly
- financial guidance
- emergency escalation
- self-harm or violence detection

Default rule:

- Dex should ask before high-risk actions
- Dex should read back important drafts before sending
- Dex should not silently escalate emergency actions unless explicitly configured

## Android Reality Check

Dex can become a very strong assistant, but Android still imposes limits.

Realistic without replacing the phone app:

- notifications
- foreground service
- app launching
- SMS reading and reply flows
- call prompts and actions
- planning, learning, reminders, support, and communication drafts

Harder without deeper phone roles:

- perfect background call answering
- full unknown-caller screening automation
- replacing the stock phone experience

That means Dex should remain:

- a powerful assistant
- not a fragile fake system app

unless we intentionally choose a deeper phone-role architecture later.

## Definition Of Success

Dex is succeeding when:

- the user can log in and understand the app immediately
- Dex is helpful every day, not just during demos
- texting, planning, learning, and reminders feel natural
- outside-the-app assistance is useful, even if Android still imposes some limits
- crisis and emotional support behavior is safe and intentional
- admin and affiliate flows support the business cleanly
