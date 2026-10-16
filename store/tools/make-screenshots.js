/*
 * Store screenshots + Google Play feature graphic, captured from the real game.
 *   node store/tools/make-screenshots.js
 * Starts a throwaway local server (its own temp data folder), seeds a few kickers for the
 * leaderboard, plays real kicks with headless Chromium and writes:
 *   store/screenshots/iphone-6.9/   1320 x 2868  (App Store, required)
 *   store/screenshots/ipad-13/      2064 x 2752  (App Store, if the app runs on iPad)
 *   store/screenshots/android-phone/ 1080 x 1920 (Google Play)
 *   store/assets/feature-graphic.png 1024 x 500  (Google Play, required)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const P = require('../../shared/physics');

const root = path.join(__dirname, '..', '..');
const PORT = 3700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SETS = [
  { dir: 'iphone-6.9', width: 440, height: 956, scale: 3 },
  { dir: 'ipad-13', width: 1032, height: 1376, scale: 2 },
  { dir: 'android-phone', width: 360, height: 640, scale: 3 },
];

// Offline profile used for the shots: mid-game gear, upgrades that reach the office (~4 km).
const LV = 3;
const OFFLINE = {
  coins: 18450, xp: 26000,
  upgrades: { boots: LV, ball: LV, training: LV, focus: LV, aero: LV, luck: LV },
  owned: ['outfit:gi', 'outfit:tee', 'outfit:blackbelt', 'ball:classic', 'ball:fire', 'trail:none', 'trail:flame'],
  equipped: { outfit: 'gi', ball: 'fire', trail: 'flame' },
  bestRound: 21840, bestKick: 4310, roundsPlayed: 64, milestones: [], daily: {}, prestige: 0,
};

async function api(p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

async function seedLeaderboard() {
  const kickers = [['Coach Carter', 9], ['Henry Fan', 7], ['Allen Eagle', 6], ['Duck Pond Dan', 4], ['Market St Mia', 3]];
  for (const [name, lvl] of kickers) {
    const { token } = await api('/api/player', { name });
    const st = await api('/api/round/start', {}, token);
    for (let i = 0; i < 10; i++) {
      const seed = P.kickSeed(st.baseSeed, i);
      let best = 0, bestD = -1;
      for (let f = 0; f < 240; f += 1 + (10 - lvl)) {
        const d = P.simulateKick(seed, f, st.upgrades).distance;
        if (d > bestD) { bestD = d; best = f; }
      }
      await api('/api/round/kick', { roundId: st.roundId, index: i, frame: best }, token);
    }
  }
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eko-shots-'));
  const server = spawn(process.execPath, [path.join(root, 'src/server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dataDir, DATABASE_URL: '', RAILWAY_ENVIRONMENT: '' }),
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* starting */ }
      await sleep(100);
    }
    await seedLeaderboard();
    const browser = await chromium.launch();
    for (const set of SETS) await shootSet(browser, set);
    await featureGraphic(browser);
    await browser.close();
  } finally {
    server.kill();
  }
}

async function newPage(browser, set) {
  const ctx = await browser.newContext({
    viewport: { width: set.width, height: set.height }, deviceScaleFactor: set.scale, isMobile: set.width < 900, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript((offline) => {
    localStorage.setItem('ek_offline', JSON.stringify(offline));
    localStorage.setItem('ek_patch_seen', JSON.stringify((window.EK_PATCH_NOTES || [{ version: '9' }])[0].version));
  }, OFFLINE);
  await page.goto(BASE + '/');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  return { ctx, page };
}

async function shootSet(browser, set) {
  const out = path.join(root, 'store/screenshots', set.dir);
  fs.mkdirSync(out, { recursive: true });
  const shot = (name) => page.screenshot({ path: path.join(out, name) });
  const { ctx, page } = await newPage(browser, set);

  // 1. Main menu with Jason.
  await page.waitForTimeout(800);
  await shot('01-menu.png');

  // 2-3. A real kick: wait for the sweet spot, then catch the ball mid-air and the result card.
  await page.click('[data-action="casual"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => new Promise((resolve) => {
    const g = window.EK.game;
    const Phys = window.EKPhysics;
    let target = null;
    const t = setInterval(() => {
      const k = g.k;
      if (!k || k.phase !== 'juggle') return;
      if (target == null) {
        let bestD = -1;
        for (let f = k.juggler.frame + 30; f < k.juggler.frame + 260; f++) {
          const d = Phys.simulateKick(k.seed, f, g.cfg.upgrades).distance;
          if (d > bestD) { bestD = d; target = f; }
        }
      }
      if (k.juggler.frame >= target) { clearInterval(t); g.input(); resolve(); }
    }, 2);
  }));
  // Mid-flight: when the ball is about two-thirds of the way out.
  await page.waitForFunction(() => {
    const k = window.EK.game.k;
    return k && k.phase === 'flight' && k.sim && k.pathPos > (k.sim.path.length / 2) * 0.62;
  }, null, { timeout: 30000, polling: 16 }).catch(() => {});
  await shot('02-flight.png');
  await page.waitForFunction(() => window.EK.game.k && window.EK.game.k.phase === 'result', null, { timeout: 30000 })
    .catch(async (e) => { console.log('phase', await page.evaluate(() => [window.EK.game.mode, window.EK.game.k && window.EK.game.k.phase])); throw e; });
  await page.waitForTimeout(900);
  await shot('03-result.png');
  await page.evaluate(() => { window.EK.game.mode = 'ended'; });
  await page.goto(BASE + '/');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');

  // 4. Career.
  await page.click('[data-action="career"]');
  await page.waitForTimeout(700);
  await shot('04-career.png');
  await page.keyboard.press('Escape');

  // 5. Leaderboard.
  await page.click('[data-action="leaderboard"]');
  await page.waitForSelector('#lbTable tr td.val');
  await page.waitForTimeout(400);
  await shot('05-leaderboard.png');
  await page.keyboard.press('Escape');

  // 6. Locker & Shop.
  await page.click('[data-action="shop"]');
  await page.waitForTimeout(700);
  const offline = await page.$('#shopProfileTabs [data-prof="offline"]');
  if (offline) { await offline.click(); await page.waitForTimeout(400); }
  await shot('06-shop.png');

  await ctx.close();
  console.log('screenshots:', path.relative(root, out));
}

async function featureGraphic(browser) {
  // Grab a wide in-game scene, then lay the title over it.
  const { ctx, page } = await newPage(browser, { width: 1024, height: 500, scale: 1 });
  await page.evaluate(() => document.querySelectorAll('.screen, #feed, #toasts').forEach((e) => (e.style.display = 'none')));
  await page.waitForTimeout(600);
  const bg = (await page.screenshot()).toString('base64');
  await page.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Lilita+One&display=swap" rel="stylesheet"></head>
    <body style="margin:0;width:1024px;height:500px;overflow:hidden;font-family:'Lilita One',sans-serif">
    <div style="position:absolute;inset:0;background:url(data:image/png;base64,${bg}) center/cover"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(270deg,rgba(4,60,110,.85) 0%,rgba(4,90,160,.55) 42%,rgba(0,0,0,0) 62%)"></div>
    <div style="position:absolute;right:56px;top:120px;text-align:right;color:#fff;text-shadow:0 4px 0 #023a63">
      <div style="font-size:84px;line-height:.95">EGGERS<br>KICK OFF</div>
      <div style="font-family:system-ui,sans-serif;font-weight:800;font-size:26px;margin-top:18px;text-shadow:none;opacity:.95">Time it. Boot it. Beat everyone.</div>
    </div></body></html>`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(root, 'store/assets/feature-graphic.png') });
  await ctx.close();
  console.log('feature graphic: store/assets/feature-graphic.png');
}

main().catch((e) => { console.error(e); process.exit(1); });
