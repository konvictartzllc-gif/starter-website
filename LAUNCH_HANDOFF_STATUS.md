# Dex Launch Handoff Status

Last updated: 2026-05-15

## Completed From This Workspace

- Web production build passes with `npm --prefix client run build`.
- Android debug build passes with `.\gradlew.bat assembleDebug`.
- Android release APK build passes with `.\gradlew.bat assembleRelease`.
- Android release App Bundle build passes with `.\gradlew.bat bundleRelease`.
- Local backend smoke test passes:
  - `/health` returns `ok`.
  - `/api/diagnostics/providers` returns core providers ready with the local environment.
  - RingCentral remains not ready in the local smoke result.
- Frontend production API wiring points to `https://konvict-artz.onrender.com/api`.
- Android default backend points to `https://konvict-artz.onrender.com/api`.
- Removed the hardcoded fallback admin email/password from `server/src/index.js`.

## Build Artifacts Created

- Android release APK:
  - `android-app/app/build/outputs/apk/release/app-release-unsigned.apk`
- Android release App Bundle:
  - `android-app/app/build/outputs/bundle/release/app-release.aab`

## User-Only Launch Tasks

These require accounts, production credentials, a real phone, or app-store access.

1. Render backend
   - Add/confirm all production environment variables in the correct Render service.
   - Redeploy the backend.
   - Open `https://konvict-artz.onrender.com/api/diagnostics/providers`.
   - Confirm core systems are green: AI, JWT secret, admin email/password, site URL/origin, Stripe.

2. Vercel frontend
   - Redeploy the frontend.
   - Confirm `https://www.konvict-artz.com/api/health` reaches the Render backend.

3. Production account proof
   - Create a brand-new user.
   - Log in on web.
   - Log in on Android.
   - Confirm trial state and Dex chat work.

4. Stripe proof
   - Complete checkout with a fresh user.
   - Confirm webhook delivery succeeds.
   - Confirm user changes from `trial` to `paid`.
   - Confirm billing portal opens.
   - Confirm cancelled/failed checkout does not show false success.

5. Admin and affiliate proof
   - Admin logs in.
   - Admin creates an affiliate invite/code.
   - Affiliate signs up with the code.
   - Affiliate dashboard loads and stats update.

6. Real Android device proof
   - Install a clean release build on the Samsung device.
   - Test login, voice, wake mode, app launching, calls, text approval/send, notification reading, and learning reminders.
   - Decide whether closed-app call/text behavior is launch-ready or should be marketed as experimental.

7. Play Store submission
   - Confirm final release keystore/signing setup.
   - Upload the `.aab`.
   - Complete app listing, screenshots, feature graphic, privacy policy URL, terms URL, support email, and Data Safety form.
   - Review sensitive permission declarations against the current Android manifest.

8. Secret rotation
   - Rotate any exposed admin, JWT, OpenAI, SMTP, Stripe, or RingCentral credentials before public launch.

## Current Code-Level Launch Note

`server/src/index.js` now refuses to start unless `ADMIN_EMAIL` and `ADMIN_PASSWORD` are configured. This is intentional for launch safety. If Render fails after this change, add those variables to the live service and redeploy.
