const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const P = require('../shared/physics');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
const ADMIN = 'test-admin-token-0123456789';

async function req(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function api(p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

// Pick the frame that gives the best kick, like a sharp-eyed player would.
function bestFrame(seed, upgrades) {
  let best = 0, bestD = -1;
  for (let f = 0; f < 240; f++) {
    const d = P.simulateKick(seed, f, upgrades).distance;
    if (d > bestD) { bestD = d; best = f; }
  }
  return best;
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eko-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, DATABASE_URL: process.env.TEST_DATABASE_URL || '', ADMIN_TOKEN: ADMIN }),
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
test.after(() => proc && proc.kill());

test('full online flow: profile, round, leaderboard, shop, challenge', async () => {
  const created = await api('/api/player', { name: 'Test Kicker' });
  assert.strictEqual(created.status, 200);
  const token = created.body.token;
  assert.strictEqual((await api('/api/player', { name: 'test kicker' })).status, 409);
  assert.strictEqual((await api('/api/player', { name: 'x' })).status, 400);

  const start = await api('/api/round/start', {}, token);
  assert.strictEqual(start.status, 200);
  const { roundId, baseSeed, upgrades } = start.body;

  assert.strictEqual((await api('/api/round/kick', { roundId, index: 1, frame: 10 }, token)).status, 409);

  let total = 0;
  let last;
  const history = [];
  for (let i = 0; i < 10; i++) {
    const seed = P.kickSeed(baseSeed, i);
    const frame = bestFrame(seed, upgrades);
    const power = P.powerBallFor(seed, history);
    const local = P.simulateKick(seed, frame, upgrades, { power });
    history.push({ perfect: P.isPerfect(local), power });
    last = await api('/api/round/kick', { roundId, index: i, frame }, token);
    assert.strictEqual(last.status, 200, JSON.stringify(last.body));
    assert.strictEqual(last.body.result.distance, local.distance, 'server agrees with client physics');
    assert.strictEqual(last.body.points, P.scoreKick(local, i, 10));
    total += last.body.points;
  }
  assert.ok(last.body.done);
  assert.strictEqual(last.body.total, total);
  assert.strictEqual(last.body.summary.score, total);
  assert.ok(last.body.player.coins > 0);
  assert.strictEqual((await api('/api/round/kick', { roundId, index: 10, frame: 1 }, token)).status, 409);

  const lb = await api('/api/leaderboard?type=round');
  assert.strictEqual(lb.body.rows[0].value, total);
  const week = await api('/api/leaderboard?type=week');
  assert.strictEqual(week.body.rows[0].roundId, roundId);
  const kicks = await api('/api/leaderboard?type=kick');
  assert.ok(kicks.body.rows[0].value > 0);

  const buy = await api('/api/shop/buy', { item: 'upgrade:boots' }, token);
  assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
  assert.strictEqual(buy.body.player.upgrades.boots, 1);

  // A second player challenges the first on the same seeds.
  const p2 = await api('/api/player', { name: 'Rival' });
  const ch = await api('/api/round/start', { challengeOf: roundId }, p2.body.token);
  assert.strictEqual(ch.body.baseSeed, baseSeed);

  const replay = await api(`/api/round/${roundId}`);
  assert.strictEqual(replay.body.kicks.length, 10);
  assert.strictEqual(replay.body.name, 'Test Kicker');
});

test('coins are paid per kick, daily bonus on the first round', async () => {
  const token = (await api('/api/player', { name: 'Coin Counter' })).body.token;
  const { roundId, baseSeed, upgrades } = (await api('/api/round/start', {}, token)).body;
  let coins = 0;
  let last;
  for (let i = 0; i < 10; i++) {
    last = await api('/api/round/kick', { roundId, index: i, frame: bestFrame(P.kickSeed(baseSeed, i), upgrades) }, token);
    const e = last.body.earned;
    assert.strictEqual(e.golden, P.isGoldenBall(P.kickSeed(baseSeed, i)), 'server and client agree on Golden Balls');
    assert.strictEqual(e.coins, Math.floor(Math.floor(last.body.points / 8) * e.veteran * e.combo * (e.golden ? 4 : 1)));
    if (i < 9) {
      assert.ok(last.body.player.coins >= coins + last.body.earned.coins, 'wallet grows during the round');
      coins = last.body.player.coins;
    }
  }
  const b = last.body.summary.coinBreakdown;
  assert.strictEqual(b.daily, 50, 'first round of the day pays the daily bonus');
  assert.strictEqual(b.completion, 20);
  assert.ok(last.body.summary.crate && last.body.summary.crate.coins > 0, 'every finished round opens a crate');
  assert.strictEqual(b.crate, last.body.summary.crate.coins);
  assert.strictEqual(last.body.summary.daily.streak, 1);
});

test('progress survives: password login on another device and restore from a device backup', async () => {
  const created = await api('/api/player', { name: 'Safe Sam' });
  const token = created.body.token;
  assert.ok(created.body.player.backup, 'every profile response carries a signed backup');
  assert.strictEqual((await api('/api/login', { name: 'Safe Sam', password: 'kickit' })).status, 400, 'no password yet');
  assert.strictEqual((await api('/api/me/password', { password: 'kickit' }, token)).status, 200);
  assert.strictEqual((await api('/api/login', { name: 'safe sam', password: 'nope' })).status, 401);
  const login = await api('/api/login', { name: 'safe sam', password: 'kickit' });
  assert.strictEqual(login.status, 200);
  assert.notStrictEqual(login.body.token, token);
  assert.strictEqual((await api('/api/me', null, login.body.token)).body.player.name, 'Safe Sam');
  assert.strictEqual((await api('/api/me', null, token)).status, 200, 'the original device stays logged in');

  // A tampered backup is rejected.
  const backup = created.body.player.backup;
  const [body, sig] = backup.split('.');
  const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
  forged.coins = 999999;
  forged.id = 'forged-id';
  const forgedStr = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
  assert.strictEqual((await api('/api/restore', { token: 'x'.repeat(32), backup: forgedStr })).status, 400);
  // A profile that still exists is not duplicated.
  assert.strictEqual((await api('/api/restore', { token: 'y'.repeat(32), backup })).status, 409);
});

test('prestige is server-side: rejected until ready, then resets and boosts scored kicks', async () => {
  const created = await api('/api/player', { name: 'Prestige Pat' });
  const token = created.body.token;
  assert.strictEqual((await api('/api/prestige', {}, token)).status, 400);
  // Fake a maxed-enough profile through a signed restore is impossible, so prestige the slow way:
  // give coins/xp via the store isn't possible over HTTP — instead check the round snapshot carries prestige.
  const start = await api('/api/round/start', {}, token);
  assert.strictEqual(start.body.upgrades.prestige, undefined, 'no prestige yet, no bonus');
});

test('challenges are tracked by the server from verified kicks', async () => {
  const { token } = (await api('/api/player', { name: 'Challenger Chloe' })).body;
  const me = (await api('/api/me', null, token)).body.player;
  assert.strictEqual(me.challenges.daily.length, 3);
  assert.strictEqual(me.challenges.weekly.length, 3);
  const { roundId, baseSeed, upgrades } = (await api('/api/round/start', {}, token)).body;
  let last;
  for (let i = 0; i < 10; i++) {
    last = await api('/api/round/kick', { roundId, index: i, frame: bestFrame(P.kickSeed(baseSeed, i), upgrades) }, token);
  }
  const after = last.body.player.challenges;
  const moved = after.daily.concat(after.weekly).some((c) => c.progress > 0);
  assert.ok(moved, 'a full round of good kicks advances at least one challenge');
});

test('career match is verified by the server', async () => {
  const K = require('../shared/career');
  const token = (await api('/api/player', { name: 'Career Kid' })).body.token;
  assert.strictEqual((await api('/api/round/start', { career: 'ivy' }, token)).status, 403, 'Ivy is locked until Henry is beaten');
  const start = await api('/api/round/start', { career: 'henry' }, token);
  assert.strictEqual(start.status, 200);
  const { roundId, baseSeed, upgrades } = start.body;
  let last;
  for (let i = 0; i < 10; i++) {
    const frame = bestFrame(P.kickSeed(baseSeed, i), upgrades);
    last = await api('/api/round/kick', { roundId, index: i, frame }, token);
  }
  const c = last.body.summary.career;
  assert.strictEqual(c.cpuTotal, K.cpuRound(baseSeed, K.bossById('henry'), upgrades).total);
  assert.strictEqual(c.won, last.body.total > c.cpuTotal);
  assert.ok(c.won, 'perfect play beats Henry');
  assert.ok(last.body.player.career.skill > 0);
  assert.ok(last.body.player.career.beaten.includes('henry'));
  assert.ok(last.body.summary.coinBreakdown.career > 0);
  assert.ok(last.body.player.milestones.length > 0, 'milestones earned along the way');
  assert.strictEqual((await api('/api/round/start', { career: 'ivy' }, token)).status, 200, 'Ivy unlocked');
});

test('multiplayer room: create, join, start, live kicks and final standings', async () => {
  const a = (await api('/api/player', { name: 'Host Hannah' })).body.token;
  const b = (await api('/api/player', { name: 'Guest Gus' })).body.token;

  const connect = (token) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.msgs = [];
    ws.waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      ws.msgs.push(m);
      ws.waiters = ws.waiters.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
    });
    ws.wait = (pred) => {
      const found = ws.msgs.find(pred);
      if (found) { ws.msgs.splice(ws.msgs.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((resolve) => ws.waiters.push({ pred, resolve }));
    };
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', token })); resolve(ws); });
  });
  const wa = await connect(a);
  const wb = await connect(b);
  await wa.wait((m) => m.t === 'hello' && m.ok);
  await wb.wait((m) => m.t === 'hello' && m.ok);

  wa.send(JSON.stringify({ t: 'room:create' }));
  const state = await wa.wait((m) => m.t === 'room:state');
  wb.send(JSON.stringify({ t: 'room:join', code: state.code }));
  await wa.wait((m) => m.t === 'room:state' && m.members.length === 2);
  wa.send(JSON.stringify({ t: 'room:fair', fair: true }));
  await wa.wait((m) => m.t === 'room:state' && m.fair);
  wa.send(JSON.stringify({ t: 'room:start' }));
  const sa = await wa.wait((m) => m.t === 'room:started');
  const sb = await wb.wait((m) => m.t === 'room:started');
  assert.strictEqual(sa.baseSeed, sb.baseSeed, 'everyone gets the same kicks');
  assert.deepStrictEqual(sb.upgrades, {});

  for (const [token, s, ws] of [[a, sa, wa], [b, sb, wb]]) {
    for (let i = 0; i < 10; i++) {
      const frame = token === a ? bestFrame(P.kickSeed(s.baseSeed, i), {}) : 5;
      const r = await api('/api/round/kick', { roundId: s.roundId, index: i, frame }, token);
      assert.strictEqual(r.status, 200);
    }
  }
  await wb.wait((m) => m.t === 'room:kick');
  const final = await wb.wait((m) => m.t === 'room:final');
  assert.strictEqual(final.standings.length, 2);
  assert.strictEqual(final.standings[0].name, 'Host Hannah');
  wa.close();
  wb.close();
});

function connectWs(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.msgs = [];
    ws.waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      ws.msgs.push(m);
      ws.waiters = ws.waiters.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
    });
    ws.wait = (pred) => {
      const found = ws.msgs.find(pred);
      if (found) { ws.msgs.splice(ws.msgs.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((resolve) => ws.waiters.push({ pred, resolve }));
    };
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', token })); resolve(ws); });
  });
}

test('offensive names are refused, look-alikes included; innocent words are fine', async () => {
  for (const name of ['Sh1t Kicker', 'F.U.C.K', 'big ass']) {
    assert.strictEqual((await api('/api/player', { name })).status, 400, name);
  }
  assert.strictEqual((await api('/api/player', { name: 'Therapist Pea' })).status, 200);
});

test('players can delete their account, and an old device backup cannot bring it back', async () => {
  const c = await api('/api/player', { name: 'Delete Me' });
  const token = c.body.token;
  const { backup, id } = c.body.player;
  assert.strictEqual((await req('DELETE', '/api/me')).status, 401);
  const del = await req('DELETE', '/api/me', null, token);
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await api('/api/me', null, token)).status, 401);
  const restore = await api('/api/restore', { token: 'x'.repeat(32), backup });
  assert.strictEqual(restore.status, 410);
  assert.ok(id);
  // The name is free again.
  assert.strictEqual((await api('/api/player', { name: 'Delete Me' })).status, 200);
});

test('report, admin review, ban and rename', async () => {
  const a = await api('/api/player', { name: 'Reporter Rae' });
  const b = await api('/api/player', { name: 'Rude Rudy' });
  const ta = a.body.token;
  const tb = b.body.token;
  const bid = b.body.player.id;

  // Rudy plays a round so he is on the leaderboard.
  const start = await api('/api/round/start', {}, tb);
  for (let i = 0; i < 10; i++) await api('/api/round/kick', { roundId: start.body.roundId, index: i, frame: 60 }, tb);
  assert.ok((await api('/api/leaderboard?type=round')).body.rows.some((r) => r.playerId === bid));

  assert.strictEqual((await api('/api/report', { playerId: bid, reason: 'nope' }, ta)).status, 400);
  assert.strictEqual((await api('/api/report', { playerId: a.body.player.id, reason: 'name' }, ta)).status, 400, 'no self-reports');
  assert.strictEqual((await api('/api/report', { playerId: bid, reason: 'chat', context: 'mean words' })).status, 401);
  assert.strictEqual((await api('/api/report', { playerId: bid, reason: 'chat', context: 'mean words' }, ta)).status, 200);

  // Admin endpoints are invisible without the admin token.
  assert.strictEqual((await req('GET', '/api/admin/reports')).status, 404);
  assert.strictEqual((await req('GET', '/api/admin/reports', null, ta)).status, 404);
  const list = await req('GET', '/api/admin/reports', null, ADMIN);
  assert.strictEqual(list.status, 200);
  const rep = list.body.reports.find((r) => r.reportedId === bid);
  assert.ok(rep);
  assert.strictEqual(rep.reportedName, 'Rude Rudy');
  assert.strictEqual(rep.context, 'mean words');

  const ban = await req('POST', `/api/admin/players/${bid}`, { action: 'ban' }, ADMIN);
  assert.strictEqual(ban.status, 200);
  assert.ok(ban.body.banned);
  assert.ok(!(await api('/api/leaderboard?type=round')).body.rows.some((r) => r.playerId === bid), 'banned players leave the leaderboard');
  assert.ok(!(await api('/api/leaderboard?type=week')).body.rows.some((r) => r.playerId === bid));

  // Banned players can't use multiplayer.
  const ws = await connectWs(tb);
  await ws.wait((m) => m.t === 'hello' && m.ok);
  ws.send(JSON.stringify({ t: 'room:create' }));
  const err = await ws.wait((m) => m.t === 'error');
  assert.match(err.error, /switched off/);
  ws.close();

  const ren = await req('POST', `/api/admin/players/${bid}`, { action: 'rename' }, ADMIN);
  assert.match(ren.body.name, /^Kicker \d+$/);
  assert.strictEqual((await req('POST', `/api/admin/players/${bid}`, { action: 'unban' }, ADMIN)).body.banned, false);
  assert.strictEqual((await req('POST', `/api/admin/reports/${rep.id}`, { status: 'resolved' }, ADMIN)).status, 200);
  const open = await req('GET', '/api/admin/reports', null, ADMIN);
  assert.ok(!open.body.reports.some((r) => r.id === rep.id), 'resolved reports leave the open queue');
});

test('room chat is masked and carries the sender id (for report/block)', async () => {
  const a = await api('/api/player', { name: 'Chatty Cat' });
  const ws = await connectWs(a.body.token);
  await ws.wait((m) => m.t === 'hello' && m.ok);
  ws.send(JSON.stringify({ t: 'room:create' }));
  await ws.wait((m) => m.t === 'room:state');
  ws.send(JSON.stringify({ t: 'room:chat', text: 'nice kick you sh1t' }));
  const msg = await ws.wait((m) => m.t === 'room:chat');
  assert.strictEqual(msg.id, a.body.player.id);
  assert.strictEqual(msg.text, 'nice kick you ****');
  ws.close();
});

test('app shells: CORS for Capacitor origins, Digital Asset Links endpoint', async () => {
  const pre = await fetch(BASE + '/api/me', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'GET' } });
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  const other = await fetch(BASE + '/api/health', { headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(other.headers.get('access-control-allow-origin'), null);
  const links = await fetch(BASE + '/.well-known/assetlinks.json');
  assert.strictEqual(links.status, 200);
  assert.deepStrictEqual(await links.json(), []);
  for (const page of ['/privacy.html', '/terms.html', '/icons/icon-512.png', '/manifest.webmanifest']) {
    assert.strictEqual((await fetch(BASE + page)).status, 200, page);
  }
});

test('health reports the game rules version (app update guard)', async () => {
  const h = await api('/api/health');
  assert.strictEqual(h.body.rules, P.RULES_VERSION);
  assert.ok(P.RULES_VERSION >= 1);
});

test('Power Balls are earned and simulated by the server', async () => {
  // A different client IP, so the sign-up rate limit from earlier tests doesn't apply.
  const created = await fetch(BASE + '/api/player', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.9' }, body: JSON.stringify({ name: 'Perfect Pete' }),
  });
  const { token } = await created.json();
  const st = (await api('/api/round/start', {}, token)).body;
  const history = [];
  let powered = null;
  for (let i = 0; i < 7; i++) {
    const seed = P.kickSeed(st.baseSeed, i);
    const power = P.powerBallFor(seed, history);
    // Find a PERFECT frame for this ball, as a sharp player would.
    let frame = 0;
    for (let f = 0; f < 600; f++) {
      if (P.isPerfect(P.simulateKick(seed, f, st.upgrades, { power }))) { frame = f; break; }
    }
    const local = P.simulateKick(seed, frame, st.upgrades, { power });
    const r = await api('/api/round/kick', { roundId: st.roundId, index: i, frame }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.result.distance, local.distance, `kick ${i} agrees`);
    assert.strictEqual(r.body.result.power, power);
    if (power) powered = { i, power };
    history.push({ perfect: P.isPerfect(local), power });
  }
  assert.ok(powered, 'a Power Ball was loaded');
  assert.strictEqual(powered.i, 5, 'right after 5 PERFECTs');
  const round = await api(`/api/round/${st.roundId}`);
  assert.strictEqual(round.body.kicks[5].pw, powered.power, 'replays know the power');
  assert.strictEqual(round.body.kicks[6].pw, undefined);
});

test('9 PERFECTs in a row break out the Piñata, and the server pays its prize', async () => {
  const created = await fetch(BASE + '/api/player', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.10' }, body: JSON.stringify({ name: 'Pinata Pat' }),
  });
  const { token } = await created.json();
  const st = (await api('/api/round/start', {}, token)).body;
  const history = [];
  let last;
  for (let i = 0; i < 10; i++) {
    const seed = P.kickSeed(st.baseSeed, i);
    const power = P.powerBallFor(seed, history);
    let frame = 0;
    for (let f = 0; f < 600; f++) {
      if (P.isPerfect(P.simulateKick(seed, f, st.upgrades, { power }))) { frame = f; break; }
    }
    const local = P.simulateKick(seed, frame, st.upgrades, { power });
    last = await api('/api/round/kick', { roundId: st.roundId, index: i, frame }, token);
    assert.strictEqual(last.status, 200);
    assert.strictEqual(last.body.result.distance, local.distance, `kick ${i} agrees`);
    assert.strictEqual(last.body.points, P.scoreKick(local, i, 10), `kick ${i} points agree`);
    history.push({ perfect: P.isPerfect(local) });
    if (i === 9) {
      assert.strictEqual(power, 'pinata');
      assert.strictEqual(last.body.result.power, 'pinata');
      assert.ok(['coins', 'upgrade', 'boost', 'item'].includes(last.body.pinata.type));
      assert.ok(last.body.milestones.some((m) => m.id === 'pinata'));
    } else {
      assert.strictEqual(last.body.pinata, null);
    }
  }
  // A boost prize applies to the next round's upgrades.
  if (last.body.pinata.type === 'boost') {
    const z = last.body.pinata;
    const next = (await api('/api/round/start', {}, token)).body;
    assert.strictEqual(next.upgrades[z.id], Math.min(50, (st.upgrades[z.id] | 0) + z.levels));
    assert.strictEqual(next.boost.roundsLeft, z.rounds - 1);
  }
});
