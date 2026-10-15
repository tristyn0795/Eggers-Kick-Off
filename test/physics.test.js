const test = require('node:test');
const assert = require('node:assert');
const P = require('../shared/physics');
const C = require('../shared/catalog');

test('kick simulation is deterministic', () => {
  const seed = P.kickSeed(987654321, 3);
  const a = P.simulateKick(seed, 140, { boots: 2 }, { record: true });
  const b = P.simulateKick(seed, 140, { boots: 2 });
  assert.strictEqual(a.distance, b.distance);
  assert.strictEqual(a.contactHeight, b.contactHeight);
});

test('live juggler matches the simulated contact point', () => {
  const seed = P.kickSeed(42, 0);
  const st = P.stats({ focus: 3 });
  const j = P.createJuggler(seed, st);
  for (let i = 0; i < 200 + P.SWING_FRAMES; i++) P.stepJuggler(j);
  const sim = P.simulateKick(seed, 200, { focus: 3 });
  assert.strictEqual(sim.contactHeight, j.y);
});

test('a perfect kick with no upgrades first-bounces near 900 m', () => {
  let best = null;
  for (let s = 0; s < 6; s++) {
    const seed = P.kickSeed(2024, s);
    for (let f = 0; f < 400; f++) {
      const r = P.simulateKick(seed, f, {});
      if (r.label === 'PERFECT!' && (!best || r.firstBounce > best.firstBounce)) best = r;
    }
  }
  assert.ok(best, 'found a perfect kick');
  assert.ok(best.firstBounce > 800 && best.firstBounce < 1000, `first bounce ${best.firstBounce}`);
});

test('upgrades make kicks longer', () => {
  const avg = (up) => {
    let sum = 0;
    for (let f = 0; f < 300; f++) sum += P.simulateKick(P.kickSeed(7, 1), f, up).distance;
    return sum / 300;
  };
  assert.ok(avg({ boots: 5, ball: 5 }) > avg({}) * 1.5);
});

test('topgolf scoring: rings, bonus and double final ball', () => {
  const office = P.TARGETS.find((t) => t.office);
  const hit = P.targetFor(office.x + 1);
  assert.strictEqual(hit.ring, 'BULLSEYE');
  assert.strictEqual(hit.points, office.pts * 3);
  assert.strictEqual(P.targetFor(3300), null);
  const fake = { distance: 1000, target: null };
  assert.strictEqual(P.scoreKick(fake, 0, 10), 100);
  assert.strictEqual(P.scoreKick(fake, 9, 10), 200);
  assert.strictEqual(P.scoreKick(fake, 5, Infinity), 100);
});

test('shop purchases respect coins and level gates', () => {
  const p = C.newProfile();
  assert.strictEqual(C.applyPurchase(p, 'upgrade:boots'), 'Not enough coins');
  p.coins = 1000;
  assert.strictEqual(C.applyPurchase(p, 'upgrade:boots'), null);
  assert.strictEqual(p.upgrades.boots, 1);
  assert.strictEqual(C.applyPurchase(p, 'upgrade:boots'), 'Reach level 2 first');
  assert.strictEqual(C.applyPurchase(p, 'outfit:polo'), null);
  assert.strictEqual(p.equipped.outfit, 'polo');
  assert.strictEqual(C.applyEquip(p, 'ball', 'gold'), 'You do not own that yet');
});
