# Apple App Store: iOS/iPadOS app (Capacitor)

Apple rejects apps that are "just a website", so the iOS app **bundles the game files inside the
app** (it works offline, like the website's Casual and Free Kick) and talks to the live server for
online play. [Capacitor](https://capacitorjs.com) wraps the files in a native iOS project.

What's already done in this repo:

- `npm run build:app` → `app-dist/`: the game with its server address baked in (`app-config.js`).
- `capacitor.config.json`: app id `com.clickwisedesign.eggerskickoff`, name, colours.
- The server allows the app's origin (`capacitor://localhost`) and the WebSocket works cross-origin.
- **Version guard:** if the server's game rules (`RULES_VERSION` in `shared/physics.js`) move ahead of
  an installed app, the app says "Update the app to play online" and keeps offline modes working.
  So: **when you change physics, scoring or targets, bump `RULES_VERSION` and ship an app update**
  (website players get it instantly). UI-only changes also need an app update to reach iOS players.
- Icons (`store/assets/appstore-icon-1024.png`, no transparency), screenshots for iPhone 6.9" and iPad 13".

## What you need

- An **Apple Developer Program** membership ($99/year). See `store/README.md`.
- A **Mac with Xcode** (latest), *or* a cloud Mac build service: Codemagic, Ionic Appflow,
  Bitrise, or GitHub Actions macOS runners. Cloud services can build and upload without a Mac.

## Build steps (on a Mac)

```bash
npm install
npm i -D @capacitor/cli @capacitor/core @capacitor/ios
npm run build:app
npx cap add ios            # first time only: creates the ios/ Xcode project (gitignored)
npx cap sync ios           # every time: copies app-dist/ into the Xcode project
npx cap open ios           # opens Xcode
```

In Xcode:

1. **Signing & Capabilities**: pick your team; bundle id `com.clickwisedesign.eggerskickoff`.
2. **General**: Version `1.6.0`, Build `1` (+1 for every upload). Deployment target iOS 15+.
   Device orientation: all; keep "Requires full screen" off so iPad multitasking works.
3. **App icon**: drag `store/assets/appstore-icon-1024.png` into `Assets → AppIcon` (single size).
4. `Info.plist`: add `ITSAppUsesNonExemptEncryption` = `NO` (the game only uses HTTPS), which skips
   the export-compliance question on every upload.
5. Product → Archive → Distribute App → App Store Connect → Upload.
6. In App Store Connect, the build appears under TestFlight in ~15 minutes. Test it, then submit.

## Android with Capacitor instead of a TWA?

Possible (`npx cap add android`), but the TWA in `store/android/` is simpler and updates instantly.
