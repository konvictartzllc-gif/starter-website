# Dex AI Assistant Play Store Release Checklist

## App identity

- App name: `Dex AI Assistant`
- Package name: `com.konvictartz.dex`
- Version code: `1`
- Version name: `1.0`

## Build and signing

- [ ] Create or choose the final release keystore
- [ ] Store the keystore and passwords securely
- [ ] Add release signing config in Android Studio
- [ ] Build a signed Android App Bundle (`.aab`)
- [ ] Install the signed release on a real phone and smoke test it

## Play Console listing

- [ ] Short description
- [ ] Full description
- [ ] App icon
- [ ] Feature graphic
- [ ] Phone screenshots
- [ ] Privacy Policy URL
- [ ] Support email

## Policy and disclosures

- [ ] Data Safety section completed to match the current Dex build
- [ ] In-app permission disclosure tested before Android runtime permission prompts
- [ ] Privacy Policy and Terms links reachable from the app/site
- [ ] Sensitive permission usage reviewed against current manifest

## Production backend

- [ ] Live backend URL is deployed over HTTPS
- [ ] Android release build points to the production backend
- [ ] Stripe live config is installed and tested
- [ ] Email config is installed and tested
- [ ] RingCentral config is installed and tested if those features will be live at launch

## Real-device release test

- [ ] Sign up
- [ ] Login
- [ ] Trial starts correctly
- [ ] Voice works
- [ ] Wake flow works
- [ ] Caller announce works
- [ ] Answer and decline by voice work
- [ ] Call placement works
- [ ] Billing flow works
- [ ] Learning reminder notification works
- [ ] App reopens cleanly after reboot/background use

## Notes

- Debug builds still allow cleartext traffic for local testing.
- Main release manifest no longer enables cleartext traffic by default.
