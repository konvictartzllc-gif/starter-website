# Dex Launch Must Do Now

This is the short list of items that still block a confident launch. If an item here is not finished, launch should wait.

## 1. Freeze And Deploy The Current Build

- [ ] Commit and push the current Android, backend, and web changes
- [ ] Redeploy Render backend
- [ ] Redeploy Vercel frontend
- [ ] Confirm the live backend and web are running the same feature set

Why this is first:

- the repo currently has uncommitted Android, backend, and web changes
- if those changes are only local, live testing will not match what Dex is actually becoming

## 2. Re-Check Live Diagnostics

- [ ] Open `https://konvict-artz.onrender.com/api/diagnostics/providers`
- [ ] Confirm:
  - `ai.ready = true`
  - `email.ready = true`
  - `stripe.ready = true`
  - `jwtSecret.configured = true`
  - `adminEmail.configured = true`
  - `adminPassword.configured = true`
  - `publicSiteUrlSet = true`
  - `clientOriginSet = true`
- [ ] Decide whether RingCentral must be launch-ready now or can ship as disabled/experimental

Launch rule:

- if core auth, AI, site URL, or Stripe are red, do not launch

## 3. Prove Live Signup And Login

- [ ] Create a brand-new regular user on production
- [ ] Log in on the web
- [ ] Log in on Android
- [ ] Confirm the user lands in the correct trial/account state
- [ ] Confirm Dex chat works for that user

Launch rule:

- if a fresh user cannot create an account and use Dex, do not launch

## 4. Prove Live Stripe End To End

- [ ] New user starts on trial
- [ ] `Start Subscription` opens Stripe Checkout
- [ ] Successful checkout returns to Dex
- [ ] Account changes from `trial` to `paid`
- [ ] `Manage Billing` opens the Stripe billing portal
- [ ] Cancel/failed checkout does not show false success
- [ ] Webhook events succeed

Reference:

- [server/STRIPE_LAUNCH_TESTS.md](./server/STRIPE_LAUNCH_TESTS.md)

Launch rule:

- if paid conversion is not proven live, do not launch subscriptions

## 5. Prove Admin And Affiliate Flow Live

- [ ] Admin can log in
- [ ] Admin can generate one-time affiliate code
- [ ] Affiliate can sign up using that code
- [ ] Affiliate dashboard loads
- [ ] Affiliate stats show signups
- [ ] Invite email behavior is confirmed
- [ ] If affiliate withdrawal is not ready, do not market it as available yet

Launch rule:

- if affiliate onboarding is part of launch messaging, this must be proven first

## 6. Prove Android Core Experience On A Clean Install

- [ ] Install the current Android build fresh
- [ ] Point it to `https://konvict-artz.onrender.com/api`
- [ ] Log in successfully
- [ ] Test Dex voice
- [ ] Test wake mode
- [ ] Test app launching
- [ ] Test in-app call flow
- [ ] Test in-app text compose / read-back / approve / send
- [ ] Test notification reading
- [ ] Test learning card and dashboard cards

Launch rule:

- if the clean-install Android experience still feels like a debug build, wait

## 7. Decide The Outside-The-App Promise

- [ ] Decide whether closed-app call/text behavior is:
  - launch-ready
  - experimental
  - post-launch
- [ ] If launching it now, test on the real Samsung device with:
  - unrestricted battery
  - notification access
  - pop-up and lock-screen notifications
  - sleeping-app exclusions removed
- [ ] If reliability is still weak, label outside-the-app behavior as limited/experimental and do not oversell it

Launch rule:

- do not promise full closed-app assistant behavior unless the Samsung device tests prove it

## 8. Final Content And Product Truth Check

- [ ] Make sure the app, website, and marketing describe only features that actually work now
- [ ] Make sure trial price and billing language match the current product
- [ ] Make sure the admin/affiliate messaging matches the actual flow
- [ ] Make sure emotional safety language does not overpromise emergency outreach

Launch rule:

- if the product promise is ahead of the product reality, tighten the promise before launch

## 9. Rotate Exposed Secrets

- [ ] Rotate admin password
- [ ] Rotate JWT secret
- [ ] Rotate OpenAI key if exposed
- [ ] Rotate SMTP password if exposed
- [ ] Rotate Stripe secrets if exposed
- [ ] Rotate RingCentral credentials if exposed

Launch rule:

- do not launch with known exposed credentials still active

## 10. Nice To Have, Not Launch Blockers

These can wait if the items above are green:

- richer chat history UI
- deeper lesson/quiz history
- affiliate withdrawal UX
- drag-and-drop home customization
- Facebook / Messenger assistant actions
- stronger recurring emotional support flows
- premium outside-the-app assistant surfaces

## Launch Decision

Launch only when these are all true:

- live diagnostics are green for core systems
- production signup/login works
- live paid subscription flow works
- admin and affiliate onboarding works
- Android clean-install core flows work
- your public feature promise matches current reality
