# Google Play: Android app (Trusted Web Activity)

The Android app is a **Trusted Web Activity (TWA)**: a small native wrapper that opens the live
game full-screen in Chrome's engine, with no browser bar. Every Railway deploy updates the app
instantly, so you only upload a new build to Play when the wrapper itself changes (rarely).

What's already done in this repo:

- `public/manifest.webmanifest`: name, icons (incl. maskable), colours, `id`, `scope`, full-screen display.
- `/.well-known/assetlinks.json`: served by the server from env vars (proves the site and app belong together).
- `store/android/twa-manifest.json`: package `com.clickwisedesign.eggerskickoff`, ready for Bubblewrap.
- Icons, screenshots, feature graphic: `store/assets/`, `store/screenshots/android-phone/`.

## Option A: PWABuilder (easiest, no tools to install)

1. Go to <https://www.pwabuilder.com>, enter `https://eggers-kick-off-production.up.railway.app`.
2. Package for stores → **Android** → Google Play.
   - Package ID: `com.clickwisedesign.eggerskickoff`
   - App name: `Eggers Kick Off`, launcher name: `Kick Off`
   - Display: `fullscreen`, Notifications: off
   - Signing key: **"Create new"**. Download the zip and **keep the keystore and its passwords
     somewhere safe (password manager + backup)**. Losing it means you can never update the app.
3. The zip has an `.aab` (upload to Play) and `assetlinks.json` (see step "Link the app" below).

## Option B: Bubblewrap CLI (repeatable builds)

Needs Node 18+, and Bubblewrap installs a JDK and Android SDK for you on first run.

```bash
npm i -g @bubblewrap/cli
mkdir eko-android && cd eko-android
cp ../store/android/twa-manifest.json .
bubblewrap init --manifest https://eggers-kick-off-production.up.railway.app/manifest.webmanifest
#   (accept the values; they match twa-manifest.json. Create the signing key when asked)
bubblewrap build          # -> app-release-bundle.aab  (upload this to Play)
```

For later updates bump `appVersionCode` (+1) and `appVersionName` in `twa-manifest.json`, then
`bubblewrap update && bubblewrap build`.

## Link the app to the site (removes the browser bar)

1. Play Console → your app → **Test and release → App integrity → App signing**: copy the
   **SHA-256 certificate fingerprint** of the *app signing key* (Google re-signs your upload).
   Also copy the *upload key* fingerprint if you want to test locally built APKs.
2. Railway → the game service → **Variables**:
   - `ANDROID_PACKAGE` = `com.clickwisedesign.eggerskickoff`
   - `ANDROID_SHA256` = `AB:CD:...` (comma-separate several fingerprints)
3. Redeploy, then check `https://eggers-kick-off-production.up.railway.app/.well-known/assetlinks.json`
   shows the fingerprint. If the app shows a URL bar, the fingerprint is wrong or missing.

## Play Console checklist

See `store/README.md` for the full list (account, testing rule, listing, data safety, rating).
