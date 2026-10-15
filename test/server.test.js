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
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, DATABASE_URL: '' }),
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
  for (let i = 0; i < 10; i++) {
    const seed = P.kickSeed(baseSeed, i);
    const frame = bestFrame(seed, upgrades);
    const local = P.simulateKick(seed, frame, upgrades);
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
