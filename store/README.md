# App store prep kit

Everything needed to put Eggers Kick Off on **Google Play** and the **Apple App Store**. The code
side is done (v1.6.0). What's left is accounts, paperwork and pressing the buttons.

| File | What it's for |
| --- | --- |
| `LISTING.md` | Store names, descriptions, keywords, categories, URLs: copy and paste |
| `PRIVACY-ANSWERS.md` | Google Play **Data safety** form and Apple **App Privacy** label answers |
| `RATINGS-AND-REVIEW.md` | Age-rating questionnaires and the notes for Apple's reviewer |
| `MODERATION.md` | How to review reports, ban and rename players |
| `android/` | Google Play build (Trusted Web Activity) instructions + Bubblewrap config |
| `ios/` | App Store build (Capacitor) instructions |
| `assets/` | Icons (512 Play, 1024 App Store), Play feature graphic (1024×500) |
| `screenshots/` | iPhone 6.9" (1320×2868), iPad 13" (2064×2752), Android phone (1080×1920) |
| `tools/` | Regenerate icons/screenshots: `npm run store:icons`, `npm run store:screenshots` |

## Already done in the game (v1.6.0)

Both stores reject games with chat or player names unless these exist. They're all live in v1.6:

- [x] **Delete account in the app**: Profile → Delete account (Apple 5.1.1(v), Google Play policy).
- [x] **Web page for deletion requests**: `/privacy.html#delete` (Google asks for this URL).
- [x] **Privacy policy** `/privacy.html` and **Terms** `/terms.html` (zero tolerance for abuse, as Apple asks).
- [x] **Filter** for names and chat (catches look-alikes like `sh1t`), **Report** and **Block** on
      the leaderboard, room members and chat lines, and an **admin queue** to act on reports (Apple 1.2).
- [x] Banned players drop off leaderboards, the live feed and multiplayer.
- [x] PNG icons (incl. maskable), full web app manifest, iOS home-screen tags, and an **📲 Install app** button.
- [x] App bundle build (`npm run build:app`), Capacitor config, TWA config, Digital Asset Links endpoint.
- [x] Version guard so an out-of-date store app can't play online with old rules.

## Step 0: things you can start now (both stores)

- [ ] **Decide the account type.** Publishing as **Click Wise Design (organization)** is
      recommended: the store shows the company as the developer and Google's 12-tester rule doesn't apply.
      Both stores then need a **D-U-N-S number** for the company.
- [ ] **Get a D-U-N-S number** (free): <https://developer.apple.com/enroll/duns-lookup/> checks if
      Click Wise already has one and requests it if not. Allow 1 to 4 weeks. The legal name and address
      must match exactly what you enter at Apple and Google.
- [ ] A **company email** for the developer accounts and a **support page** (a contact page on
      clickwisedesign.com is fine).
- [ ] Set **`ADMIN_TOKEN`** on Railway (see `MODERATION.md`) so you can handle reports.
      Both stores expect reports to be acted on, ideally within 24 hours.

## Google Play

- [ ] Create a Play Console developer account: <https://play.google.com/console/signup>
      ($25 one-time). Organization: D-U-N-S + company website. Expect identity verification.
- [ ] **Personal accounts only:** before production you must run a **closed test with at least
      12 testers opted in for 14 days in a row**. Recruit playtesters (John & co.) early.
- [ ] Create the app: name "Eggers Kick Off", Game, Free.
- [ ] Build the `.aab` (see `android/README.md`), upload to an **internal testing** track first.
- [ ] Put the Play **app signing SHA-256** in Railway as `ANDROID_SHA256` (+ `ANDROID_PACKAGE`), redeploy.
- [ ] Store listing: text from `LISTING.md`, icon `assets/play-icon-512.png`, feature graphic
      `assets/feature-graphic.png`, phone screenshots `screenshots/android-phone/`.
- [ ] App content: privacy policy URL, **Data safety** (`PRIVACY-ANSWERS.md`), **content rating**
      (`RATINGS-AND-REVIEW.md`), target audience **13+**, ads: **No**, data deletion URL.
- [ ] Closed test → production. Review usually takes a few days.

## Apple App Store

- [ ] Enroll in the Apple Developer Program: <https://developer.apple.com/programs/enroll/>
      ($99/year). Organization: D-U-N-S, legal entity, website, and authority to sign for Click Wise.
- [ ] A Mac with Xcode, or a cloud Mac build service (see `ios/README.md`).
- [ ] App Store Connect → new app: bundle id `com.clickwisedesign.eggerskickoff`, SKU `eggers-kick-off`.
- [ ] Build & upload with Xcode, test through **TestFlight** (up to 10,000 testers by link).
- [ ] Listing: text from `LISTING.md`, screenshots `screenshots/iphone-6.9/` and `screenshots/ipad-13/`.
- [ ] **App Privacy** label (`PRIVACY-ANSWERS.md`), **age rating** questionnaire, review notes
      with a demo account (`RATINGS-AND-REVIEW.md`).
- [ ] Submit for review (typically 1 to 3 days). Common rejection reasons are covered: account
      deletion, user-generated content controls, and "just a website" (the game is bundled and works offline).

## Costs

| | Google Play | Apple |
| --- | --- | --- |
| Developer account | $25 once | $99 per year |
| D-U-N-S number | free | free |
| Mac / build service | not needed | a Mac, or a cloud build plan (free tiers exist) |

## Keeping the apps up to date

- **Android (TWA)** and the **website** update the moment Railway deploys.
- **iOS** carries its own copy of the game: after a release, run `npm run build:app && npx cap sync ios`
  and upload a new build. If the release changes physics/scoring/targets, bump `RULES_VERSION` in
  `shared/physics.js`; older iOS builds then ask players to update before playing online.
