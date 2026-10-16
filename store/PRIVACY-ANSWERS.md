# Privacy answers for both stores

Based on what the game actually does (see `/privacy.html`). No ads, no analytics SDKs, no tracking,
no third-party logins. If you add any of those later, these answers must change.

## Google Play: Data safety form

**Does your app collect or share any of the required user data types?** Yes

**Is all of the user data collected by your app encrypted in transit?** Yes

**Do you provide a way for users to request that their data is deleted?** Yes
(in-app: Profile → Delete account; web: `/privacy.html#delete`)

| Data type | Collected | Shared | Optional? | Purpose |
| --- | --- | --- | --- | --- |
| Personal info → **Name** (kicker nickname) | Yes | No | Optional (only for online play) | App functionality |
| Personal info → **User IDs** (random player id) | Yes | No | Optional | App functionality, Account management |
| App activity → **App interactions** (rounds, kicks, scores) | Yes | No | Optional | App functionality |
| App activity → **Other user-generated content** (room chat, reports) | Yes | No | Optional | App functionality |

Answer **No** for everything else (location, contacts, financial info, health, messages/email/SMS,
photos, audio, files, calendar, device IDs, crash logs, diagnostics, web browsing).

Notes for the form:
- "Shared" means sent to third parties. Data shown to other players at the user's request
  (name on leaderboards, chat) and data processed by your host (Railway, a service provider)
  doesn't count as sharing.
- Chat is relayed live and not stored. Google still counts it as collected because it leaves the device.
- Is data processed ephemerally? Chat: **Yes**. Everything else: **No**.

**Data deletion URL**: `https://eggers-kick-off-production.up.railway.app/privacy.html#delete`

## Apple: App Privacy ("nutrition label")

**Do you or your third-party partners collect data from this app?** Yes

| Category → type | Linked to the user? | Used for tracking? | Purpose |
| --- | --- | --- | --- |
| Identifiers → **User ID** | Yes | No | App Functionality |
| User Content → **Gameplay Content** (rounds, replays, scores) | Yes | No | App Functionality |
| User Content → **Other User Content** (kicker name, chat, reports) | Yes | No | App Functionality |

Everything else: **Not collected**. Tracking: **No** (so no App Tracking Transparency prompt is needed).

The label will read: *Data Linked to You: Identifiers, User Content. Data Not Used to Track You.*

## Account creation & sign-in (Apple)

- Accounts are optional; offline modes need none. Players pick a nickname, and a password is optional.
- No email, phone or social login, so **Sign in with Apple is not required**.
- Account deletion is in the app (Profile → Delete account) and deletes server data immediately.
