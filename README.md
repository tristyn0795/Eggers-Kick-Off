# Eggers Kick Off ⚽

A multiplayer remake of the classic Miniclip "kick for distance" game. **Jason** juggles the ball,
you time the kick, and the ball flies toward the **Click Wise Design Office** at 4,000 m — and
beyond. There's no finish line: it's scored like **Topgolf**, with targets all down the field.

![Jason kicking](docs/jason-kick.png)

## How it plays

- Jason juggles the ball off his knee to a random height each time. **Click, tap or press any
  key** to swing. His foot meets the ball 6 frames later, so you have to read the bounce.
- Strike it in the **sweet spot** (chest–head height) for a PERFECT kick: about 900 m to the
  first bounce, like the original. Too high = whiff. Too low = weak line drive.
- **Bounce pads** launch the ball on, **puddles** kill it, and **wind** pushes it around.

### Scoring (Topgolf-style)
- 1 point per 10 m.
- Stop the ball inside a target for bonus points: outer ring ×1, inner ×2, **bullseye ×3**.
  Targets: Coffee Cup (150 m), Car Park, Duck Pond, Water Tower, Pizza Shack, Billboard,
  **Click Wise Design Office (4,000 m, 250 pts)**, Downtown, Airport, Mountain Peak, Satellite Dish (10 km).
- A round is 10 kicks, and the **last ball scores double**.

### Progression
- Every round earns **coins** and **XP**. Levels gate better gear.
- **Upgrades** (5 levels each): Power Boots, Pro Ball, Sweet Spot Training, Slow-Mo Focus,
  Aero Laces, Lucky Socks.
- **Cosmetics:** outfits (Jason's black gi is the default, plus the white competition gi, the
  Black Belt Promotion, the Click Wise tee/polo, suit, Hawaiian, astronaut…), balls (including the Eggers
  Egg) and trails.

### Modes
| Mode | Online? | Notes |
|---|---|---|
| **Play Online** | ✅ | Ranked 10-kick round. Counts for the leaderboards. |
| **Multiplayer Room** | ✅ | 4-letter room code or invite link. Everyone gets the same 10 juggles, wind and field, with live standings and chat. The host can turn on "level playing field" (no upgrades). |
| **Challenge a friend** | ✅ | Share a link. Your friend plays your exact 10 kicks to try to beat your score. Leaderboard rows have "Beat it" buttons too. |
| **Casual Round** | ❌ | Offline 10-kick round with its own local progress. |
| **Free Kick** | ❌ | Endless offline practice that earns coins per kick. |

Leaderboards: **Best Round**, **This Week**, **Longest Kick** (with replays you can watch).

Offline play works with no connection: a service worker caches the game after the first visit.

## Anti-cheat
Physics are deterministic and shared by the browser and the server (`shared/physics.js`). The
client only sends *which frame the player kicked on*. The server re-simulates the kick from the
round's secret-until-started seed, using the player's server-side upgrades, and scores it
itself. Nobody can post a fake distance.

## Deploy on Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo.
   Railway detects Node and runs `npm start` (see `railway.json`, which also sets the
   `/api/health` health check).
3. Add a database: **+ New → Database → PostgreSQL**. Then, on the game service, go to
   **Variables → Add Reference → `DATABASE_URL`** from the Postgres service. Tables are created
   automatically on boot.
4. **Settings → Networking → Generate Domain** to get a public URL (or add your own domain,
   e.g. `kick.clickwisedesign.com`).

That's it: WebSockets work out of the box on Railway.

> Without `DATABASE_URL` the server falls back to a JSON file in `./data` (or `DATA_DIR`).
> That's fine locally, but on Railway the file is wiped on every deploy unless you attach a
> volume and point `DATA_DIR` at it. Use Postgres.

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Set by Railway automatically |
| `DATABASE_URL` | – | Postgres connection string (recommended) |
| `DATA_DIR` | `./data` | JSON-file storage location when no database |
| `PGSSL` | – | Set to `disable` if your Postgres doesn't use SSL |

## Run locally
```bash
npm install
npm start          # http://localhost:3000
npm test           # physics, scoring, shop, full API + multiplayer room tests
```

## Project layout
```
shared/physics.js   deterministic juggle/kick/flight simulation + Topgolf scoring (client & server)
shared/catalog.js   upgrades, cosmetics, levels, coin rewards (client & server)
src/server.js       Express API + WebSocket rooms, live feed
src/store.js        Postgres store with JSON-file fallback
public/js/render.js canvas renderer (Jason, field, targets, landmarks, office)
public/js/game.js   game loop & kick state machine
public/js/app.js    menus, shop, leaderboard, rooms, online/offline profiles
```

Accounts are lightweight: pick a kicker name and the browser keeps a secret token. Players can
copy a **transfer code** from their profile to continue on another device.
