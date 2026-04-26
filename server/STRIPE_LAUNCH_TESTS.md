# Dex Stripe Launch Tests

Use this checklist before launch with Stripe test mode first, then repeat in live mode.

## Required environment variables

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`
- `STRIPE_PORTAL_RETURN_URL`
- `PUBLIC_SITE_URL`

Recommended return URLs:

- success: `https://www.konvict-artz.com/settings?billing=success`
- cancel: `https://www.konvict-artz.com/settings?billing=cancelled`
- portal return: `https://www.konvict-artz.com/settings`

## Test 1: New account on trial

1. Register a brand-new user.
2. Confirm login succeeds.
3. Open Settings > Billing.
4. Confirm:
   - status shows `Trial`
   - trial days left is greater than `0`
   - `Start Subscription` button is visible

Expected result:

- user has `access_type = trial`
- no Stripe customer is required yet

## Test 2: Checkout session opens

1. While logged in as the trial user, click `Start Subscription`.
2. Confirm Stripe Checkout opens.

Expected result:

- backend returns `checkoutUrl`
- user row stores `stripe_checkout_session_id`

## Test 3: Successful subscription

1. Complete checkout with a Stripe test card.
2. Wait for redirect back to Settings.
3. Confirm the page shows the success notice.
4. Refresh Settings.

Expected result:

- `access_type = paid`
- `stripe_customer_id` is stored
- `stripe_subscription_id` is stored
- `sub_expires` is set
- `Manage Billing` button is visible

## Test 4: Webhook proof

1. In Stripe Dashboard or Stripe CLI, confirm the webhook delivery succeeded.
2. Check:
   - `checkout.session.completed`
   - `customer.subscription.created` or `updated`
   - `invoice.payment_succeeded`

Expected result:

- webhook endpoint returns success
- no signature errors
- payment row is created or updated

## Test 5: Billing portal

1. As the paid user, click `Manage Billing`.
2. Confirm Stripe Billing Portal opens.
3. Return to Dex.

Expected result:

- portal session opens successfully
- return URL lands back on Settings

## Test 6: Cancel / failed checkout

1. Start checkout again with another test user.
2. Back out before completion.
3. Confirm Dex returns to Settings with a cancelled notice.

Expected result:

- account stays on trial or expired, depending on prior state
- no false success notice

## Test 7: Trial expiry recovery

1. Force a trial user into expired state by adjusting `trial_start` in the database or waiting out the trial in test.
2. Log in.
3. Try to chat with Dex.

Expected result:

- chat blocks with `trial_expired`
- user can reach checkout from chat or Settings
- billing recovery notice appears on Settings

## Test 8: Subscription expiry recovery

1. Use Stripe test tools to cancel or expire a subscription.
2. Confirm webhook runs.
3. Try to use Dex again.

Expected result:

- user becomes `expired`
- chat blocks with `subscription_expired`
- checkout recovery path works

## Test 9: Admin account protection

1. Log in as your admin account.
2. Open Billing and chat.

Expected result:

- admin remains `unlimited`
- admin is never blocked by Stripe access state

## Test 10: Affiliate payout trigger

1. Create a user through an affiliate code.
2. Subscribe successfully.
3. Check affiliate stats.

Expected result:

- affiliate `signups` increases on registration
- affiliate `paid_subs` and `earnings` update only once on first paid activation
