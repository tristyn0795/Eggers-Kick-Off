'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const P = require('../shared/physics');
const C = require('../shared/catalog');
const { createStore, NameTakenError } = require('./store');

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

const BLOCKED_WORDS = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'bitch', 'whore', 'slut', 'rape', 'nazi'];
function cleanName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 16) throw new HttpError(400, 'Name must be 2–16 characters');
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(name)) throw new HttpError(400, 'Letters, numbers, spaces and _ . \' - only');
  const flat = name.toLowerCase().replace(/[^a-z]/g, '');
  if (BLOCKED_WORDS.some((w) => flat.includes(w))) throw new HttpError(400, 'Please pick a different name');
  return { name, nameKey: name.toLowerCase() };
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
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const staticOpts = { maxAge: '1h', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') };
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), {
    setHeaders: (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.use(express.static(path.join(__dirname, '..', 'public'), Object.assign({}, staticOpts, {
    setHeaders: (res, file) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (/\.(html|js|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    },
  })));

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

  app.get('/api/health', wrap(async () => ({ ok: true, store: store.kind, online: sockets.size })));

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

  app.get('/api/me', auth, wrap(async (req) => {
    const p = req.player;
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

  app.post('/api/shop/buy', auth, wrap(async (req) => withLock('p:' + req.player.id, async () => {
    const p = await store.getPlayer(req.player.id);
    const err = C.applyPurchase(p, req.body && req.body.item);
    if (err) throw new HttpError(400, err);
    await store.savePlayer(p);
    return { player: publicPlayer(p) };
  })));

  app.post('/api/shop/equip', auth, wrap(async (req) => withLock('p:' + req.player.id, async () => {
    const p = await store.getPlayer(req.player.id);
    const err = C.applyEquip(p, req.body && req.body.slot, req.body && req.body.id);
    if (err) throw new HttpError(400, err);
    await store.savePlayer(p);
    return { player: publicPlayer(p) };
  })));

  async function startRound(player, { challengeOf = null, room = null, baseSeed = null, fair = false } = {}) {
    let seed = baseSeed;
    if (challengeOf) {
      const ch = await store.getRound(String(challengeOf));
      if (!ch || !ch.finished) throw new HttpError(404, 'That challenge no longer exists');
      seed = ch.baseSeed;
    }
    const round = {
      id: newId(),
      playerId: player.id,
      baseSeed: seed == null ? newSeed() : seed,
      upgrades: fair ? {} : Object.assign({}, player.upgrades),
      kicks: [],
      score: 0,
      finished: false,
      room,
      challengeOf: challengeOf || null,
    };
    await store.createRound(round);
    return round;
  }

  app.post('/api/round/start', auth, rateLimit({ windowMs: 60e3, max: 30 }), wrap(async (req) => {
    const round = await startRound(req.player, { challengeOf: req.body && req.body.challengeOf });
    return { roundId: round.id, baseSeed: round.baseSeed, upgrades: round.upgrades, kicks: KICKS };
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
        if (done) {
          round.finished = true;
          round.finishedAt = Date.now();
          const levelBefore = C.levelFromXp(player.xp);
          const coins = C.coinsForRound(round.score);
          player.coins += coins;
          player.xp += round.score;
          player.roundsPlayed += 1;
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
          summary = {
            score: round.score, coins, xp: round.score, newBestRound,
            levelBefore, levelAfter: C.levelFromXp(player.xp), challenge,
            ranks: { round: await store.rankOf('round', player), kick: await store.rankOf('kick', player) },
          };
        }
        await store.saveRound(round);
        await store.savePlayer(player);
        return { round, player, result, points, done, summary, newBestKick };
      });
    });

    const { round, player, result, points, done, summary, newBestKick } = out;
    if (result.distance >= 2500 || (result.target && (result.target.mult === 3 || result.target.office))) {
      broadcastAll({ t: 'feed', name: player.name, distance: result.distance, target: result.target, label: result.label });
    }
    if (round.room) roomKick(round.room, player, round, points, result);

    return {
      index, points, total: round.score, done, summary, newBestKick,
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
    if (!m || m.roundId !== round.id) return;
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
      ws.player = p ? { id: p.id, name: p.name } : null;
      return send(ws, { t: 'hello', ok: !!p, online: sockets.size });
    }
    if (!ws.player) return send(ws, { t: 'error', error: 'Sign in to use rooms' });

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
      const text = String(msg.text || '').slice(0, 120).trim();
      if (room && text) roomBroadcast(room, { t: 'room:chat', name: ws.player.name, text });
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
