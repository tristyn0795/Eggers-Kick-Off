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
  assert.strictEqual(P.targetFor(2200), null);
  assert.strictEqual(P.targetFor(3300).name, 'Gas Station');
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

test('milestones pay out once and level-ups pay coins', () => {
  const p = C.newProfile();
  p.bestKick = 1200;
  const got = C.checkMilestones(p, { kick: { distance: 1200, label: 'GOOD', target: { name: 'Duck Pond', ring: 'OUTER RING' } } });
  assert.deepStrictEqual(got.map((m) => m.id).sort(), ['henry', 'k1000', 'k500', 'target']);
  assert.strictEqual(p.coins, 100 + 200 + 100 + 250);
  assert.strictEqual(C.checkMilestones(p, { kick: { distance: 1200, label: 'GOOD' } }).length, 0);
  assert.strictEqual(C.levelUpBonus(1, 3), C.levelUpCoins(2) + C.levelUpCoins(3));
});

test('upgrades go to level 10 and the map reaches the Moon Base', () => {
  const p = C.newProfile();
  p.coins = 1e6;
  p.xp = C.xpForLevel(30);
  for (let i = 0; i < 10; i++) assert.strictEqual(C.applyPurchase(p, 'upgrade:boots'), null);
  assert.strictEqual(C.applyPurchase(p, 'upgrade:boots'), 'Already maxed out');
  assert.ok(P.stats({ boots: 10 }).power > P.stats({ boots: 5 }).power);
  assert.strictEqual(P.TARGETS[P.TARGETS.length - 1].name, 'Moon Base');
});

test('career: bosses unlock in order, wins raise skill, Pro unlocks the Mastery Pro Ball', () => {
  const K = require('../shared/career');
  let career = K.newCareer();
  assert.ok(K.isUnlocked(career, 'henry'));
  assert.ok(!K.isUnlocked(career, 'ivy'));
  const cpu = K.cpuRound(12345, K.bossById('henry'));
  assert.strictEqual(cpu.kicks.length, 10);
  assert.deepStrictEqual(K.cpuRound(12345, K.bossById('henry')), cpu, 'boss scores are deterministic');
  const win = K.applyResult(career, K.bossById('henry'), cpu.total + 1, cpu.total);
  assert.ok(win.outcome.won && win.outcome.firstWin && win.outcome.reward > 0);
  assert.ok(win.career.skill > 0);
  assert.ok(K.isUnlocked(win.career, 'ivy'));
  const lose = K.applyResult(win.career, K.bossById('henry'), 0, cpu.total);
  assert.ok(lose.career.skill <= win.career.skill);
  const p = C.newProfile();
  assert.ok(!C.isOwned(p, 'ball', 'mastery'));
  assert.strictEqual(C.applyPurchase(p, 'ball:mastery'), 'Earn this by going Pro in Career mode');
  career = Object.assign(K.newCareer(), { skill: 990 });
  const pro = K.applyResult(career, K.bossById('max'), 99999, 1);
  assert.ok(pro.outcome.wentPro && pro.career.pro);
  p.career = pro.career;
  assert.ok(C.isOwned(p, 'ball', 'mastery'));
});

test('economy: steep upgrade curve, per-kick coins, daily streak', () => {
  for (const u of C.UPGRADES) {
    for (let l = 1; l < C.MAX_UPGRADE; l++) assert.ok(C.upgradeCost(u.id, l) > C.upgradeCost(u.id, l - 1));
  }
  assert.ok(C.upgradeCost('boots', 9) > 15000, 'top upgrade levels are a real grind');
  const p = C.newProfile();
  const a = C.awardKick(p, 800);
  assert.strictEqual(a.coins, 100);
  assert.strictEqual(p.xp, 800);
  assert.strictEqual(p.coins, 100 + a.levelBonus);
  const day = Date.UTC(2026, 9, 16, 12);
  assert.strictEqual(C.applyDaily(p, day).bonus, 50);
  assert.strictEqual(C.applyDaily(p, day).bonus, 0, 'once per day');
  assert.strictEqual(C.applyDaily(p, day + 86400000).bonus, 100, 'streak day 2');
  assert.strictEqual(C.applyDaily(p, day + 3 * 86400000).bonus, 50, 'streak resets after a missed day');
});
