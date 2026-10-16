'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const P = require('../shared/physics');
const C = require('../shared/catalog');
const K = require('../shared/career');
const CH = require('../shared/challenges');
const { createStore, NameTakenError } = require('./store');
const { isOffensive, maskText } = require('./moderation');

const PORT = Number(process.env.PORT) || 3000;
const KICKS = P.KICKS_PER_ROUND;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const newSeed = () => crypto.randomBytes(4).readUInt32BE(0);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 16) throw new HttpError(400, 'Name must be 2–16 characters');
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(name)) throw new HttpError(400, 'Letters, numbers, spaces and _ . \' - only');
  if (isOffensive(name)) throw new HttpError(400, 'Please pick a different name');
  return { name, nameKey: name.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Progress protection: signed backups the browser keeps, and password logins.
// ---------------------------------------------------------------------------
let BACKUP_SECRET = null;

function signBackup(p) {
  const data = {
    v: 1, id: p.id, name: p.name, coins: p.coins, xp: p.xp, upgrades: p.upgrades, owned: p.owned,
    equipped: p.equipped, bestRound: p.bestRound, bestKick: p.bestKick, roundsPlayed: p.roundsPlayed,
    milestones: p.milestones || [], career: p.career || {}, daily: p.daily || {}, prestige: p.prestige | 0, t: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', BACKUP_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyBackup(str) {
  const [body, sig] = String(str || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', BACKUP_SECRET).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
}

const scryptAsync = (pw, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(pw, salt, 32, (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${(await scryptAsync(pw, salt)).toString('base64url')}`;
}

async function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const got = await scryptAsync(pw, salt);
  const want = Buffer.from(hash, 'base64url');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    coins: p.coins,
    xp: p.xp,
    level: C.levelFromXp(p.xp),
    upgrades: p.upgrades,
    owned: p.owned,
    equipped: Object.assign({}, C.DEFAULT_EQUIPPED, p.equipped),
    bestRound: p.bestRound,
    bestKick: p.bestKick,
    roundsPlayed: p.roundsPlayed,
    milestones: p.milestones || [],
    career: K.normalize(p.career),
    daily: p.daily || {},
    hasPassword: !!p.passwordHash,
    prestige: p.prestige | 0,
    challenges: p.challenges || {},
    banned: !!p.banned,
    backup: signBackup(p),
  };
}

// Serialise work per key (one round's kicks, one player's purchases).
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return next;
}

// Tiny fixed-window rate limiter.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: 'Slow down a little!' });
    next();
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
async function main() {
  const store = await createStore();
  // The backup-signing key. Set PROFILE_SECRET so backups stay valid even if the database is replaced.
  BACKUP_SECRET = process.env.PROFILE_SECRET || (await store.setSetting('profile_secret', crypto.randomBytes(32).toString('hex')));
  if (!process.env.PROFILE_SECRET) console.warn('PROFILE_SECRET is not set; using a key stored in the database for progress backups.');
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // The iOS/Android app shells load the game from inside the app (capacitor://localhost or
  // https://localhost) and call this server, so those origins (plus any in APP_ORIGINS) may use the API.
  const appOrigins = new Set(['capacitor://localhost', 'ionic://localhost', 'https://localhost', 'http://localhost',
    ...String(process.env.APP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && appOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Digital Asset Links: lets the Google Play app (a Trusted Web Activity) open this site full-screen
  // with no browser bar. Set ANDROID_PACKAGE and ANDROID_SHA256 (from Play Console → App signing).
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const pkg = process.env.ANDROID_PACKAGE || 'com.clickwisedesign.eggerskickoff';
    const prints = String(process.env.ANDROID_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean);
    res.json(prints.length ? [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
    }] : []);
  });

  // Every response for game files must be revalidated (cheap 304s when unchanged), and the
  // page links its CSS/JS with a per-deploy version so a phone can never mix an old
  // stylesheet with a new page (that once stacked the HUD into a column).
  const ASSET_VERSION = `${require('../package.json').version}-${Date.now().toString(36)}`;
  const noCache = (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
  };
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')
    .replace(/__ASSET_VERSION__/g, ASSET_VERSION);
  app.get(['/', '/index.html'], (req, res) => {
    noCache(res);
    res.type('html').send(indexHtml);
  });
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), { setHeaders: noCache }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: false, setHeaders: noCache }));

  const auth = async (req, res, next) => {
    try {
      const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
      if (!m) throw new HttpError(401, 'Not signed in');
      const player = await store.getPlayerByTokenHash(sha256(m[1]));
      if (!player) throw new HttpError(401, 'Unknown player — create a new profile');
      req.player = player;
      next();
    } catch (e) {
      next(e);
    }
  };
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => res.json(out), next);

  const APP_VERSION = require('../package.json').version;
  app.get('/api/health', wrap(async () => ({ ok: true, store: store.kind, online: sockets.size, version: APP_VERSION, rules: P.RULES_VERSION })));

  app.post('/api/player', rateLimit({ windowMs: 3600e3, max: 20 }), wrap(async (req) => {
    const { name, nameKey } = cleanName(req.body && req.body.name);
    const token = newId(24);
    const base = C.newProfile();
    let player;
    try {
      player = await store.createPlayer({
        id: newId(), tokenHash: sha256(token), name, nameKey,
        coins: base.coins, xp: base.xp, upgrades: base.upgrades, owned: base.owned, equipped: base.equipped,
      });
    } catch (e) {
      if (e instanceof NameTakenError) throw new HttpError(409, e.message);
      throw e;
    }
    return { token, player: publicPlayer(player) };
  }));

  // Recreate a profile from a backup this device holds, if the server no longer has it.
  app.post('/api/restore', rateLimit({ windowMs: 3600e3, max: 20 }), wrap(async (req) => {
    const { token, backup } = req.body || {};
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw new HttpError(400, 'Bad token');
    const data = verifyBackup(backup);
    if (!data || data.v !== 1 || typeof data.id !== 'string') throw new HttpError(400, 'That backup could not be verified');
    if (await store.getPlayer(data.id)) throw new HttpError(409, 'That profile still exists — log in with your name and password');
    if (await store.getSetting('deleted:' + data.id)) throw new HttpError(410, 'That profile was deleted');
    let { name, nameKey } = cleanName(data.name);
    for (let i = 2; (await store.getPlayerByNameKey(nameKey)) && i < 100; i++) {
      name = `${data.name.slice(0, 13)} ${i}`;
      nameKey = name.toLowerCase();
    }
    const base = C.newProfile();
    const p = await store.createPlayer({
      id: data.id, tokenHash: sha256(token), name, nameKey, coins: 0, xp: 0,
      upgrades: base.upgrades, owned: base.owned, equipped: base.equipped,
    });
    Object.assign(p, {
      coins: data.coins | 0, xp: data.xp | 0, upgrades: data.upgrades || {}, owned: data.owned || base.owned,
      equipped: data.equipped || base.equipped, bestRound: data.bestRound | 0, bestKick: Number(data.bestKick) || 0,
      roundsPlayed: data.roundsPlayed | 0, milestones: data.milestones || [], career: data.career || {}, daily: data.daily || {},
      prestige: data.prestige | 0,
    });
    await store.savePlayer(p);
    console.log(`Restored profile ${p.id} (${p.name}) from a device backup`);
    return { restored: true, player: publicPlayer(p) };
  }));

  // Log in on any device with kicker name + password.
  const loginFails = new Map();
  setInterval(() => loginFails.clear(), 15 * 60e3).unref();
  app.post('/api/login', rateLimit({ windowMs: 15 * 60e3, max: 20 }), wrap(async (req) => {
    const { name, password } = req.body || {};
    const nameKey = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if ((loginFails.get(nameKey) || 0) >= 8) throw new HttpError(429, 'Too many attempts — try again in 15 minutes');
    const p = nameKey && (await store.getPlayerByNameKey(nameKey));
    if (p && !p.passwordHash) throw new HttpError(400, 'That kicker has no password yet. Set one in Profile on your original device.');
    if (!p || !(await checkPassword(String(password || ''), p.passwordHash))) {
      loginFails.set(nameKey, (loginFails.get(nameKey) || 0) + 1);
      throw new HttpError(401, 'Wrong name or password');
    }
    const token = newId(24);
    await store.addToken(p.id, sha256(token));
    return { token, player: publicPlayer(p) };
  }));

  app.post('/api/me/password', auth, wrap(async (req) => withLock('p:' + req.player.id, async () => {
    const pw = String((req.body && req.body.password) || '');
    if (pw.length < 4 || pw.length > 64) throw new HttpError(400, 'Password must be 4–64 characters');
    const p = await store.getPlayer(req.player.id);
    p.passwordHash = await hashPassword(pw);
    await store.savePlayer(p);
    return { player: publicPlayer(p) };
  })));

  app.get('/api/me', auth, wrap(async (req) => {
    const p = req.player;
    // Hand out today's / this week's challenges when a new period starts.
    if (CH.roll(p)) await withLock('p:' + p.id, async () => {
      const fresh = await store.getPlayer(p.id);
      if (CH.roll(fresh)) await store.savePlayer(fresh);
      p.challenges = fresh.challenges;
    });
    return {
      player: publicPlayer(p),
      ranks: { round: await store.rankOf('round', p), kick: await store.rankOf('kick', p) },
    };
  }));

  app.post('/api/me/name', auth, wrap(async (req) => withLock('p:' + req.player.id, async () => {
    const p = await store.getPlayer(req.player.id);
    Object.assign(p, cleanName(req.body && req.body.name));
    try {
      await store.savePlayer(p);
    } catch (e) {
      if (e instanceof NameTakenError) throw new HttpError(409, e.message);
      throw e;
    }
    return { player: publicPlayer(p) };
  })));

  // Delete the account and everything tied to it (required by both app stores).
  app.delete('/api/me', auth, wrap(async (req) => withLock('p:' + req.player.id, async () => {
    const id = req.player.id;
    await store.deletePlayer(id);
    await store.setSetting('deleted:' + id, String(Date.now())); // so an old device backup can't bring it back
    for (const ws of sockets) {
      if (ws.player && ws.player.id === id) { leaveRoom(ws); ws.player = null; }
    }
    console.log(`Deleted profile ${id} at the player's request`);
    return { deleted: true };
  })));

  // Players report names or chat they find abusive; an admin reviews them.
  const REPORT_REASONS = ['name', 'chat', 'cheating', 'other'];
  app.post('/api/report', auth, rateLimit({ windowMs: 3600e3, max: 20 }), wrap(async (req) => {
    const { playerId, reason, context } = req.body || {};
    if (typeof playerId !== 'string' || playerId === req.player.id) throw new HttpError(400, 'Pick a player to report');
    if (!REPORT_REASONS.includes(reason)) throw new HttpError(400, 'Pick a reason');
    const target = await store.getPlayer(playerId);
    if (!target) throw new HttpError(404, 'Player not found');
    await store.createReport({
      id: newId(), reporterId: req.player.id, reportedId: target.id, reportedName: target.name,
      reason, context: String(context || '').slice(0, 300),
    });
    return { ok: true };
  }));

  // Moderation for whoever runs the game. Set ADMIN_TOKEN (a long random string) on the server and
  // send it as "Authorization: Bearer <token>". Without ADMIN_TOKEN these endpoints are switched off.
  const adminAuth = (req, res, next) => {
    const want = process.env.ADMIN_TOKEN || '';
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    const ok = want.length >= 16 && m && m[1].length === want.length && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(want));
    if (!ok) return next(new HttpError(404, 'Not found'));
    next();
  };
  app.get('/api/admin/reports', adminAuth, wrap(async (req) => {
    const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : req.query.status === 'all' ? null : 'open';
    return { reports: await store.listReports(status, 200) };
  }));
  app.post('/api/admin/reports/:id', adminAuth, wrap(async (req) => {
    const status = (req.body && req.body.status) === 'resolved' ? 'resolved' : 'dismissed';
    await store.setReportStatus(req.params.id, status);
    return { ok: true };
  }));
  app.post('/api/admin/players/:id', adminAuth, wrap(async (req) => withLock('p:' + req.params.id, async () => {
    const p = await store.getPlayer(req.params.id);
    if (!p) throw new HttpError(404, 'Player not found');
    const { action } = req.body || {};
    if (action === 'ban' || action === 'unban') p.banned = action === 'ban';
    else if (action === 'rename') {
      // Give the player a neutral name; they can choose a new one in Profile.
      let name;
      do { name = `Kicker ${crypto.randomInt(1000, 99999)}`; } while (await store.getPlayerByNameKey(name.toLowerCase()));
      Object.assign(p, { name, nameKey: name.toLowerCase() });
    } else throw new HttpError(400, 'action must be ban, unban or rename');
    await store.savePlayer(p);
    for (const ws of sockets) {
      if (ws.player && ws.player.id === p.id) {
        ws.player.name = p.name;
        ws.player.banned = !!p.banned;
        if (p.banned) leaveRoom(ws);
      }
    }
    return { id: p.id, name: p.name, banned: !!p.banned };
  })));

  app.post('/api/shop/buy', auth, wrap(async (req) => withLock('p:' + req.player.id, async () => {
    const p = await store.getPlayer(req.player.id);
    const err = C.applyPurchase(p, req.body && req.body.item);
    if (err) throw new HttpError(400, err);
    await store.savePlayer(p);
    return { player: publicPlayer(p) };
  })));

  app.post('/api/prestige', auth, wrap(async (req) => withLock('p:' + req.player.id, async () => {
    const p = await store.getPlayer(req.player.id);
    const err = C.applyPrestige(p);
    if (err) throw new HttpError(400, err);
    const milestones = C.checkMilestones(p, {});
    await store.savePlayer(p);
    console.log(`${p.name} reached prestige ${p.prestige}`);
    return { player: publicPlayer(p), milestones };
  })));

  app.post('/api/shop/equip', auth, wrap(async (req) => withLock('p:' + req.player.id, async () => {
    const p = await store.getPlayer(req.player.id);
    const err = C.applyEquip(p, req.body && req.body.slot, req.body && req.body.id);
    if (err) throw new HttpError(400, err);
    await store.savePlayer(p);
    return { player: publicPlayer(p) };
  })));

  async function startRound(player, { challengeOf = null, room = null, baseSeed = null, fair = false, career = null } = {}) {
    let seed = baseSeed;
    if (career) {
      if (!K.bossById(career)) throw new HttpError(400, 'Unknown boss');
      if (!K.isUnlocked(K.normalize(player.career), career)) throw new HttpError(403, 'Beat the previous boss first');
      challengeOf = null;
    }
    if (challengeOf) {
      const ch = await store.getRound(String(challengeOf));
      if (!ch || !ch.finished) throw new HttpError(404, 'That challenge no longer exists');
      seed = ch.baseSeed;
    }
    const round = {
      id: newId(),
      playerId: player.id,
      baseSeed: seed == null ? newSeed() : seed,
      // Snapshot the kicker's gear for this round; prestige adds permanent power in the physics.
      upgrades: fair ? {} : Object.assign({}, player.upgrades, player.prestige ? { prestige: player.prestige | 0 } : {}),
      kicks: [],
      score: 0,
      finished: false,
      room,
      challengeOf: challengeOf || null,
      career: career || null,
    };
    await store.createRound(round);
    return round;
  }

  app.post('/api/round/start', auth, rateLimit({ windowMs: 60e3, max: 30 }), wrap(async (req) => {
    const body = req.body || {};
    const round = await startRound(req.player, { challengeOf: body.challengeOf, career: body.career ? String(body.career) : null });
    return { roundId: round.id, baseSeed: round.baseSeed, upgrades: round.upgrades, kicks: KICKS, career: round.career };
  }));

  app.post('/api/round/kick', auth, wrap(async (req) => {
    const { roundId, index, frame } = req.body || {};
    return processKick(req.player.id, String(roundId), index, frame);
  }));

  async function processKick(playerId, roundId, index, frame) {
    if (!Number.isInteger(index) || !Number.isInteger(frame) || frame < 0 || frame > P.MAX_WAIT_FRAMES) {
      throw new HttpError(400, 'Bad kick');
    }
    const out = await withLock('r:' + roundId, async () => {
      const round = await store.getRound(roundId);
      if (!round || round.playerId !== playerId) throw new HttpError(404, 'Round not found');
      if (round.finished) throw new HttpError(409, 'Round already finished');
      if (index !== round.kicks.length) throw new HttpError(409, 'Kick out of order');

      const result = P.simulateKick(P.kickSeed(round.baseSeed, index), frame, round.upgrades);
      const points = P.scoreKick(result, index, KICKS);
      round.kicks.push({ f: frame, d: result.distance, p: points, t: result.target ? result.target.name : null });
      round.score += points;
      const done = round.kicks.length >= KICKS;

      return withLock('p:' + playerId, async () => {
        const player = await store.getPlayer(playerId);
        let summary = null;
        const newBestKick = result.distance > player.bestKick;
        if (newBestKick) {
          player.bestKick = result.distance;
          player.bestKickRoundId = round.id;
          player.bestKickIndex = index;
        }
        // Coins and XP are paid on every kick so the wallet ticks up as you play.
        // Good kicks in a row build a combo; Golden Balls pay extra.
        const entry = round.kicks[round.kicks.length - 1];
        entry.g = C.isGoodKick(result) ? 1 : 0;
        let streak = 0;
        for (let i = round.kicks.length - 1; i >= 0 && round.kicks[i].g; i--) streak++;
        const golden = P.isGoldenBall(P.kickSeed(round.baseSeed, index));
        const award = C.awardKick(player, points, { streak, golden });
        entry.c = award.coins;
        entry.lb = award.levelBonus;
        const milestones = C.checkMilestones(player, { kick: result });
        const challenges = CH.progress(player, { kick: result });
        if (done) {
          round.finished = true;
          round.finishedAt = Date.now();
          player.coins += C.ROUND_COMPLETION_COINS;
          player.roundsPlayed += 1;
          const daily = C.applyDaily(player, round.finishedAt);
          const kickCoins = round.kicks.reduce((n, k) => n + (k.c || 0), 0);
          const levelBonus = round.kicks.reduce((n, k) => n + (k.lb || 0), 0);
          const levelAfter = C.levelFromXp(player.xp);
          const levelBefore = C.levelFromXp(Math.max(0, player.xp - round.score));
          const newBestRound = round.score > player.bestRound;
          if (newBestRound) {
            player.bestRound = round.score;
            player.bestRoundId = round.id;
          }
          let challenge = null;
          if (round.challengeOf) {
            const ch = await store.getRound(round.challengeOf);
            const owner = ch && (await store.getPlayer(ch.playerId));
            if (ch) challenge = { name: owner ? owner.name : 'Someone', score: ch.score, won: round.score > ch.score };
          }
          let career = null;
          if (round.career) {
            const boss = K.bossById(round.career);
            const cpu = K.cpuRound(round.baseSeed, boss, round.upgrades);
            const applied = K.applyResult(player.career, boss, round.score, cpu.total);
            player.career = applied.career;
            player.coins += applied.outcome.reward;
            career = applied.outcome;
          }
          const roundChallenges = CH.progress(player, { round: { score: round.score, careerWon: !!(career && career.won) } });
          challenges.push(...roundChallenges);
          const crate = C.openCrate(player, `${round.id}:${player.id}`);
          const roundMilestones = C.checkMilestones(player, { roundScore: round.score });
          summary = {
            score: round.score, coins: kickCoins + C.ROUND_COMPLETION_COINS, xp: round.score, newBestRound,
            levelBefore, levelAfter, levelBonus, challenge, career, daily, crate,
            coinBreakdown: {
              points: kickCoins,
              completion: C.ROUND_COMPLETION_COINS,
              daily: daily.bonus,
              crate: crate.coins,
              levelBonus,
              career: career ? career.reward : 0,
              milestones: roundMilestones.reduce((n, m) => n + m.reward, 0),
              challenges: roundChallenges.reduce((n, c) => n + c.reward, 0),
            },
            milestones: roundMilestones,
            nextUnlock: C.nextUnlocks(levelAfter),
            ranks: { round: await store.rankOf('round', player), kick: await store.rankOf('kick', player) },
          };
        }
        await store.saveRound(round);
        await store.savePlayer(player);
        return { round, player, result, points, done, summary, newBestKick, milestones, award, challenges };
      });
    });

    const { round, player, result, points, done, summary, newBestKick, milestones, award, challenges } = out;
    // Hold the news back until the kick has finished playing on the kicker's screen,
    // so nobody (the kicker included) sees a result while the ball is still flying.
    const ticks = P.playbackTicks(result.flightFrames);
    const revealMs = Math.min(30000, Math.round((ticks / 60) * 1000) + 300);
    setTimeout(() => {
      if (!player.banned && (result.distance >= 2500 || (result.target && (result.target.mult === 3 || result.target.office)))) {
        broadcastAll({ t: 'feed', playerId: player.id, name: player.name, distance: result.distance, target: result.target, label: result.label });
      }
      if (round.room) roomKick(round.room, player, round, points, result);
    }, revealMs);

    return {
      index, points, total: round.score, done, summary, newBestKick, milestones, challenges,
      earned: {
        coins: award.coins, levelBonus: award.levelBonus, levelAfter: award.levelAfter, levelBefore: award.levelBefore,
        combo: award.combo, streak: award.streak, golden: award.golden, veteran: award.veteran,
      },
      result: {
        distance: result.distance, firstBounce: result.firstBounce, label: result.label,
        quality: result.quality, target: result.target, whiff: result.whiff,
      },
      player: publicPlayer(player),
    };
  }

  app.get('/api/round/:id', wrap(async (req) => {
    const r = await store.getRound(req.params.id);
    if (!r) throw new HttpError(404, 'Round not found');
    const p = await store.getPlayer(r.playerId);
    return {
      id: r.id, name: p ? p.name : 'Unknown', baseSeed: r.baseSeed, upgrades: r.upgrades,
      kicks: r.kicks, score: r.score, finished: r.finished,
      equipped: p ? Object.assign({}, C.DEFAULT_EQUIPPED, p.equipped) : C.DEFAULT_EQUIPPED,
    };
  }));

  app.get('/api/leaderboard', wrap(async (req) => {
    const type = ['round', 'kick', 'week'].includes(req.query.type) ? req.query.type : 'round';
    const rows = await store.leaderboard(type, 50);
    return { type, rows: rows.map((r) => Object.assign(r, { level: C.levelFromXp(r.xp || 0) })) };
  }));

  app.get('/api/stats', wrap(async () => Object.assign(await store.stats(), { online: sockets.size })));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON' });
    if (!(err instanceof HttpError)) console.error(err);
    res.status(err.status || 500).json({ error: err instanceof HttpError ? err.message : 'Server error' });
  });

  // -------------------------------------------------------------------------
  // WebSocket: live feed, online count and multiplayer rooms
  // -------------------------------------------------------------------------
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const sockets = new Set();
  const rooms = new Map();

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  function broadcastAll(msg) {
    const s = JSON.stringify(msg);
    for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
  }
  let onlineTimer = null;
  function announceOnline() {
    if (onlineTimer) return;
    onlineTimer = setTimeout(() => { onlineTimer = null; broadcastAll({ t: 'online', count: sockets.size }); }, 1000);
  }

  function roomCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do {
      code = Array.from(crypto.randomBytes(4), (b) => letters[b % letters.length]).join('');
    } while (rooms.has(code));
    return code;
  }

  function roomView(room) {
    return {
      t: 'room:state',
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      fair: room.fair,
      members: [...room.members.values()].map((m) => ({
        id: m.id, name: m.name, connected: !!m.ws, total: m.total, kicks: m.kicks, done: m.done,
        lastDistance: m.lastDistance, best: m.best,
      })),
    };
  }
  function roomBroadcast(room, msg) {
    for (const m of room.members.values()) if (m.ws) send(m.ws, msg);
  }
  function roomSync(room) {
    roomBroadcast(room, roomView(room));
  }

  function leaveRoom(ws) {
    const room = ws.roomCode && rooms.get(ws.roomCode);
    ws.roomCode = null;
    if (!room) return;
    const m = room.members.get(ws.player.id);
    if (m && m.ws === ws) {
      if (room.status === 'playing' && m.roundId) m.ws = null; // keep their score on the board
      else room.members.delete(ws.player.id);
    }
    if (![...room.members.values()].some((x) => x.ws)) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === ws.player.id) {
      const next = [...room.members.values()].find((x) => x.ws);
      room.hostId = next.id;
    }
    maybeFinishRoom(room);
    roomSync(room);
  }

  function maybeFinishRoom(room) {
    if (room.status !== 'playing') return;
    const active = [...room.members.values()].filter((m) => m.roundId);
    if (active.every((m) => m.done || !m.ws)) {
      room.status = 'finished';
      const standings = active.slice().sort((a, b) => b.total - a.total).map((m, i) => ({ place: i + 1, id: m.id, name: m.name, total: m.total, best: m.best }));
      roomBroadcast(room, { t: 'room:final', standings });
    }
  }

  function roomKick(code, player, round, points, result) {
    const room = rooms.get(code);
    if (!room) return;
    const m = room.members.get(player.id);
    if (!m || m.roundId !== round.id || round.kicks.length < m.kicks) return;
    m.total = round.score;
    m.kicks = round.kicks.length;
    m.done = round.finished;
    m.lastDistance = result.distance;
    if (result.distance > m.best) m.best = result.distance;
    roomBroadcast(room, {
      t: 'room:kick', id: player.id, name: player.name, index: round.kicks.length - 1, points,
      distance: result.distance, target: result.target, label: result.label,
    });
    maybeFinishRoom(room);
    roomSync(room);
  }

  async function handleWs(ws, msg) {
    if (msg.t === 'hello') {
      const p = typeof msg.token === 'string' ? await store.getPlayerByTokenHash(sha256(msg.token)) : null;
      ws.player = p ? { id: p.id, name: p.name, banned: !!p.banned } : null;
      return send(ws, { t: 'hello', ok: !!p, online: sockets.size });
    }
    if (!ws.player) return send(ws, { t: 'error', error: 'Sign in to use rooms' });
    if (ws.player.banned && msg.t.startsWith('room:') && msg.t !== 'room:leave') {
      return send(ws, { t: 'error', error: 'Multiplayer is switched off for this account' });
    }

    if (msg.t === 'room:create') {
      leaveRoom(ws);
      const room = { code: roomCode(), hostId: ws.player.id, status: 'lobby', fair: false, members: new Map(), baseSeed: null };
      rooms.set(room.code, room);
      joinRoom(ws, room);
    } else if (msg.t === 'room:join') {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return send(ws, { t: 'error', error: 'Room not found — check the code' });
      if (room.status === 'playing' && !room.members.has(ws.player.id)) return send(ws, { t: 'error', error: 'That room is mid-game. Try again when it finishes.' });
      if (room.members.size >= 12 && !room.members.has(ws.player.id)) return send(ws, { t: 'error', error: 'Room is full' });
      leaveRoom(ws);
      joinRoom(ws, room);
    } else if (msg.t === 'room:leave') {
      leaveRoom(ws);
      send(ws, { t: 'room:left' });
    } else if (msg.t === 'room:fair') {
      const room = rooms.get(ws.roomCode);
      if (!room || room.hostId !== ws.player.id || room.status === 'playing') return;
      room.fair = !!msg.fair;
      roomSync(room);
    } else if (msg.t === 'room:start') {
      const room = rooms.get(ws.roomCode);
      if (!room || room.hostId !== ws.player.id) return send(ws, { t: 'error', error: 'Only the host can start' });
      if (room.status === 'playing') return;
      room.status = 'playing';
      room.baseSeed = newSeed();
      for (const [id, m] of room.members) {
        if (!m.ws) { room.members.delete(id); continue; }
        const player = await store.getPlayer(id);
        const round = await startRound(player, { room: room.code, baseSeed: room.baseSeed, fair: room.fair });
        Object.assign(m, { roundId: round.id, total: 0, kicks: 0, done: false, lastDistance: null, best: 0 });
        send(m.ws, { t: 'room:started', code: room.code, roundId: round.id, baseSeed: round.baseSeed, upgrades: round.upgrades, kicks: KICKS });
      }
      roomSync(room);
    } else if (msg.t === 'room:reset') {
      const room = rooms.get(ws.roomCode);
      if (!room || room.hostId !== ws.player.id || room.status !== 'finished') return;
      room.status = 'lobby';
      for (const [id, m] of room.members) {
        if (!m.ws) room.members.delete(id);
        else Object.assign(m, { roundId: null, total: 0, kicks: 0, done: false, lastDistance: null, best: 0 });
      }
      roomSync(room);
    } else if (msg.t === 'room:chat') {
      const room = rooms.get(ws.roomCode);
      const text = maskText(String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120).trim());
      if (room && text) roomBroadcast(room, { t: 'room:chat', id: ws.player.id, name: ws.player.name, text });
    }
  }

  function joinRoom(ws, room) {
    ws.roomCode = room.code;
    const existing = room.members.get(ws.player.id);
    if (existing) {
      if (existing.ws && existing.ws !== ws) { existing.ws.roomCode = null; send(existing.ws, { t: 'room:left' }); }
      existing.ws = ws;
    } else {
      room.members.set(ws.player.id, {
        id: ws.player.id, name: ws.player.name, ws, roundId: null, total: 0, kicks: 0, done: false, lastDistance: null, best: 0,
      });
    }
    roomSync(room);
  }

  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.isAlive = true;
    ws.player = null;
    ws.roomCode = null;
    ws.msgCount = 0;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      if (++ws.msgCount > 60) return; // per heartbeat window
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      handleWs(ws, msg).catch((e) => {
        console.error('ws error', e);
        send(ws, { t: 'error', error: e instanceof HttpError ? e.message : 'Server error' });
      });
    });
    ws.on('close', () => {
      sockets.delete(ws);
      if (ws.player) leaveRoom(ws);
      announceOnline();
    });
    announceOnline();
  });

  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.msgCount = 0;
      ws.ping();
    }
  }, 25000);

  server.listen(PORT, () => {
    console.log(`Eggers Kick Off listening on :${PORT} (storage: ${store.kind})`);
  });

  const shutdown = () => {
    clearInterval(heartbeat);
    if (store.flush) store.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
