# Eggers Kick Off: notes for Claude

Read this first. It's the project memory: how the game is built, the rules that must not break,
how to ship, and what the players have asked for. Keep it up to date when something important changes.

## What this is

A browser remake of Miniclip's *Monkey Kick Off*. Jason juggles a ball and kicks it as far as he can
toward (and far past) the Click Wise Design office in Allen, TX. Topgolf-style scoring, no end goal.

- **Live:** https://eggers-kick-off-production.up.railway.app (version at `/api/health`)
- **Repo:** github.com/tristyn0795/Eggers-Kick-Off, branch `main`
- **Hosting:** Railway, one Node service + a Postgres database. **Every push to `main` auto-deploys**
  in 1–3 minutes. If a push doesn't go live, check status.railway.com (pushes made while Railway
  pauses builds are dropped; redeploy from the dashboard or push again once it recovers).
- **Players:** a small group of friends and coworkers. The main playtester is **John**, who sends
  detailed feedback and idea lists; credit him in patch notes ("thanks John!") when shipping his ideas.

## Stack and layout

Node 22, Express 4, `ws` 8, `pg` 8. No build step and no frontend framework: plain JS on a canvas.

```
shared/physics.js     Deterministic juggle/kick/flight sim, scoring, targets, Power Balls, RULES_VERSION
shared/catalog.js     Upgrades, cosmetics (SLOTS), economy, milestones, crates, piñata prizes, seasons
shared/career.js      12 Career bosses (Wii Sports style), CPU kicks, skill rating
shared/challenges.js  Daily and weekly challenges
src/server.js         Express API + WebSocket (rooms, chat, live feed), anti-cheat re-simulation
src/store.js          PgStore (production) and FileStore (local/tests); schema migrations run on start
src/moderation.js     Name/chat word filter
public/js/game.js     60 Hz game loop, kick state machine, camera, Henry rendering logic
public/js/render.js   Canvas renderer: field, landmarks, Jason, Henry, balls, trails, particles, themes
public/js/app.js      Menus, HUD, shop/Locker, leaderboards, rooms, profiles, offline mode
public/js/patchnotes.js  In-game patch notes (newest first)
public/sw.js          Service worker (offline Casual / Free Kick)
store/                App Store / Google Play prep kit (see store/README.md)
scripts/build-app.js  Bundles the game into app-dist/ for the iOS (Capacitor) app
test/                 node:test suites (physics, store, server API, moderation, client parse)
```

`shared/*.js` files are UMD: browser globals (`EKPhysics`, `EKCatalog`, `EKCareer`, `EKChallenges`)
and `module.exports` for the server. The server also serves them at `/shared/...`.

## Rules that must not break

1. **The server is the authority.** The client only sends `{ roundId, index, frame }` (the juggle
   frame it pressed kick on). The server re-simulates every kick with `shared/physics.js`, so
   **anything that changes a kick's outcome must be deterministic and identical on client and server**:
   no `Math.random` in physics, seeds via `hashSeed`/`kickSeed`, no dependence on local time.
2. **Bump `RULES_VERSION` in `shared/physics.js`** whenever physics, scoring, targets or Power Ball
   rules change. Out-of-date clients see the mismatch on `/api/health` and refresh (the iOS app asks
   players to update).
3. **Never lose player progress.** Production must run on Postgres: the server refuses to start on a
   hosted box without `DATABASE_URL`. Every profile carries an HMAC-signed device backup
   (`PROFILE_SECRET`) that `/api/restore` can rebuild from. Schema changes are additive
   (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and must migrate old data.
4. **Never remove or rename a cosmetic item id.** Players own items by id (`owned: ['ball:jackoball', ...]`).
   Seasonal items (`season: 'halloween'`) can only be *bought* in season (`C.SEASONS`, 1 Oct – 7 Nov UTC)
   but owners keep and equip them forever. Tests enforce this.
5. **Characters are cosmetic only.** Jason and Henry kick with identical physics; Henry is just drawn
   smaller (`HENRY_SCALE`/`HENRY_ZOOM` in `game.js`). Same for outfits, balls and trails.
6. **Leaderboards stay fair.** Any new gameplay modifier must be server-verified and the same for everyone.

## How things work (quick reference)

- **Scoring:** 1 pt per 10 m + target ring bonus (outer ×1, inner ×2, bullseye ×3); last ball ×2.
- **Economy:** coins paid per kick (`awardKick`: combo up to ×3, Golden Ball ×4 for ~1 in 8 balls,
  veteran bonus, prestige bonus), completion bonus, daily streak, a Kick Crate per finished round,
  milestones, challenges. Upgrades go to level 50; Prestige resets upgrades and coins for permanent bonuses.
- **Power Balls:** `powerBallFor(seed, history)` where history is the round's earlier kicks `{ perfect }`.
  Every 5 PERFECTs in a row → random one of `POWER_IDS` (fire, bouncy, meteor, magnet, split);
  every 9 → `pinata`. Server stores per kick `q` (perfect), `pw` (power) and `pz` (piñata prize type).
- **Piñata prizes** (`openPinata`): coins / free upgrade level / +5 boost for 2 rounds (`profile.boost`,
  applied in `startRound`, not in Career) / random gear. Fixed by key `${round.id}:${index}`.
- **Career:** bosses scale with the player's gear (`bossGearLevel`), losses always cost skill,
  1,000 skill = PRO and the Mastery Pro Ball. Bosses earn Power Balls by the same rule.
- **Cosmetic slots** (`C.SLOTS`): `outfit` (Jason), `ball`, `trail`, `character` (jason/henry),
  `henryfit` (Henry's Closet). Shop/Locker renders from these lists.
- **Landing animations:** special balls animate at rest (`restT`) in `render.js` (Jack-o'-Ball,
  Eye-Ball, Crystal, Orb, Brew, Medusa); target-zone critters pop up (`CRITTERS` map).
- **Easter egg:** Medusa Ball stopped at the Duck Pond turns Henry into a concrete porch goose
  (secret `porchgoose` milestone).
- **Halloween Night:** on 31 Oct (player's local date) `EK.theme = 'halloween'` re-skins the field.
  Preview any day with `?theme=halloween`.
- **Moderation:** filter in `src/moderation.js`; players can report/block; admin endpoints need
  `ADMIN_TOKEN` (see `store/MODERATION.md`). Account deletion: `DELETE /api/me`.

## Shipping a change

1. Make the change. Keep player-facing text short and friendly.
2. `npm test` must pass (it also checks every browser script parses and every file `index.html`
   references exists, because `main` goes straight to production).
3. For anything visual, look at it: run the server locally and screenshot with Playwright
   (headless Chromium is installed in Claude cloud sessions) on phone (390×844), small phone
   (360×640), landscape (844×390) and desktop (1440×900).
4. Release bookkeeping, every time:
   - bump `version` in `package.json`
   - add a dated entry at the top of `public/js/patchnotes.js`
   - bump `CACHE` in `public/sw.js`
   - bump `RULES_VERSION` if kick rules changed
5. Push to `main`, then confirm `/api/health` shows the new version.

## Running locally

```bash
npm install
npm start                      # http://localhost:3000, JSON-file storage in ./data
npm test                       # all suites (~12 s)
TEST_DATABASE_URL=postgres://... npm test   # run the server tests against Postgres (use a fresh DB)
```

Environment variables (names only; values live in Railway): `DATABASE_URL`, `PROFILE_SECRET`
(keep it safe: changing it invalidates device backups), `ADMIN_TOKEN`, `PGSSL`, `DATA_DIR`,
`ALLOW_EPHEMERAL_STORAGE`, `ANDROID_PACKAGE`, `ANDROID_SHA256`, `APP_ORIGINS`.

## Gotchas

- The server reads `public/index.html` once at startup. Restart a local server after editing it,
  or screenshots will show the old page.
- When editing JS with scripts, watch apostrophes inside single-quoted strings (`'Jason's'` broke the
  whole client once; the client parse test now catches it).
- Server tests create many players; `/api/player` is rate-limited per IP, so new tests send their
  own `X-Forwarded-For` header.
- Don't kill the local server with `pkill -f "node src/server.js"` from a shell whose own command
  line contains that text (it kills the shell). Match the process list instead.
- Canvas emoji (critters) can look faded in headless Chromium; they're fine on real devices.
- Landing animations use a minimum on-screen size so they read when the camera is zoomed out.

## Player feedback history (so you know what's been decided)

- Jason's look: black gi, white hair, grey goatee, medal, flip-flops. Henry is a white duckling (Duck Pond).
- Asked for and built: patch notes in the UI, coin explanations, Career mode with the Mastery Pro Ball,
  never losing progress, a grindier economy, upgrades to 50, Prestige, Allen landmarks (Market Street,
  Watters Creek Bathrooms, Celebration Park, Allen Premium Outlets, Allen Eagle Stadium), daily/weekly
  challenges, better high-level grind (combos, Golden Balls, crates), phone/foldable/desktop layout,
  account deletion + report/block (app-store prep), Power Balls, Piñata Ball, Split Shot, Halloween
  gear and Halloween Night, target critters, play as Henry, Henry's Closet.
- Decisions: Power Ball and Piñata boosts are fixed percentages of the kick you hit (fair at every
  level); the Piñata never costs distance; the Pirate Captain outfit is year-round; the hockey-mask
  outfit avoids the "Jason Voorhees" name; Henry stays visibly smaller than Jason.
- Offered but not built: collectible Halloween candy (a coin bonus for stopping at a landmark on 31 Oct).

## Not done yet

- App store launch: accounts, D-U-N-S, listings and builds. Everything prepared is in `store/README.md`.
- Optional custom domain (would need `store/` URLs, `twa-manifest.json` and `scripts/build-app.js` updated).
