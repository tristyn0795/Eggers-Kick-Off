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
  assert.strictEqual(P.targetFor(3650), null);
  assert.strictEqual(P.targetFor(2200).name, 'Watters Creek Bathrooms');
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

test('upgrades go to level 50, levels 1-10 unchanged, and the map scales with them', () => {
  const p = C.newProfile();
  p.coins = 1e8;
  p.xp = C.xpForLevel(120);
  for (let i = 0; i < 50; i++) assert.strictEqual(C.applyPurchase(p, 'upgrade:boots'), null, `level ${i + 1}`);
  assert.strictEqual(C.applyPurchase(p, 'upgrade:boots'), 'Already maxed out');
  // Levels 1-10 keep their old effect and price.
  assert.strictEqual(P.stats({ boots: 10 }).power, 1.5);
  assert.strictEqual(C.upgradeCost('boots', 9), 21450);
  for (let l = 10; l < 50; l++) assert.ok(C.upgradeCost('boots', l) > C.upgradeCost('boots', l - 1));
  assert.ok(P.stats({ boots: 50 }).power > P.stats({ boots: 10 }).power);
  const ball = P.stats({ ball: 50 });
  assert.ok(ball.restitution * ball.friction < 0.9, 'bounces still die out');
  assert.ok(P.TARGETS.some((t) => t.name === 'Eggers Galaxy HQ'));
  assert.ok(P.TARGETS[P.TARGETS.length - 1].x <= P.FIELD_LENGTH);
  const lvl = C.UPGRADE_LEVEL_REQ;
  assert.strictEqual(lvl.length, 50);
  assert.strictEqual(lvl[9], 22);
});

test('long kicks always replay in about ten seconds', () => {
  for (const n of [500, 5000, 30000, 54000]) assert.ok(P.playbackTicks(n) / 60 < 11, `${n} frames`);
});

test('prestige: requirement, reset, permanent bonuses and prestige gear', () => {
  const p = C.newProfile();
  p.coins = 1e8;
  p.xp = C.xpForLevel(120);
  p.owned.push('ball:cw');
  p.milestones = ['k500'];
  assert.match(C.applyPrestige(p), /150 total upgrade levels/);
  for (const u of C.UPGRADES) for (let i = 0; i < 25; i++) C.applyPurchase(p, `upgrade:${u.id}`);
  assert.strictEqual(C.totalUpgradeLevels(p), 150);
  const xp = p.xp;
  assert.strictEqual(C.applyPrestige(p), null);
  assert.strictEqual(p.prestige, 1);
  assert.deepStrictEqual(p.upgrades, {});
  assert.strictEqual(p.coins, C.PRESTIGE_START_COINS);
  assert.strictEqual(p.xp, xp, 'level kept');
  assert.ok(p.owned.includes('ball:cw') && p.milestones.includes('k500'), 'gear and milestones kept');
  assert.ok(C.isOwned(p, 'ball', 'star') && !C.isOwned(p, 'trail', 'aura'));
  const q = Object.assign(C.newProfile(), { xp: p.xp });
  assert.strictEqual(C.awardKick(p, 800).coins, Math.floor(100 * 1.1 * C.veteranMult(xp)), '+10% coins');
  assert.strictEqual(C.awardKick(q, 800).coins, Math.floor(100 * C.veteranMult(xp)));
  assert.strictEqual(P.stats({ prestige: 1 }).power, 1.02, '+2% power');
  assert.strictEqual(C.prestigeRequirement(1), 180);
  assert.strictEqual(C.prestigeRequirement(20), 300);
});

test('career: bosses unlock in order, wins raise skill, Pro unlocks the Mastery Pro Ball', () => {
  const K = require('../shared/career');
  let career = K.newCareer();
  assert.ok(K.isUnlocked(career, 'henry'));
  assert.ok(!K.isUnlocked(career, 'ivy'));
  const cpu = K.cpuRound(12345, K.bossById('henry'), {});
  assert.strictEqual(cpu.kicks.length, 10);
  assert.deepStrictEqual(K.cpuRound(12345, K.bossById('henry'), {}), cpu, 'boss scores are deterministic');
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

test('career stays challenging: bosses scale with your upgrades, and every loss costs skill', () => {
  const K = require('../shared/career');
  const gear = (L) => ({ boots: L, ball: L, training: L, focus: L, aero: L, luck: L });
  const mo = K.bossById('mo');
  assert.strictEqual(K.bossGearLevel(mo, {}), mo.gear, 'new players face the base boss');
  assert.ok(K.bossGearLevel(mo, gear(30)) > 30, 'a strong boss out-gears a strong player');
  assert.ok(K.bossGearLevel(K.bossById('henry'), gear(30)) < 30, 'early bosses stay a little behind you');
  for (const b of K.BOSSES) {
    for (const skill of [0, 500, 798, 1500, 2400]) assert.ok(K.skillDelta(skill, b, false) < 0, `${b.id} at ${skill}`);
  }
  assert.ok(K.skillDelta(798, mo, false) > K.skillDelta(798, K.bossById('henry'), false), 'losing to a weaker boss hurts more');
  const kicks = K.cpuRound(99, K.bossById('ivy'), gear(5)).kicks;
  assert.deepStrictEqual(K.cpuKick(99, K.bossById('ivy'), 4, gear(5)), kicks[4], 'kicks can be revealed one at a time');
});

test('daily & weekly challenges: shared picks, personal goals, paid once, bonus for all dailies', () => {
  const CH = require('../shared/challenges');
  const now = Date.UTC(2026, 9, 16, 12);
  const rookie = C.newProfile();
  const pro = Object.assign(C.newProfile(), { bestKick: 20000, bestRound: 30000, xp: C.xpForLevel(40) });
  CH.roll(rookie, now);
  CH.roll(pro, now);
  assert.strictEqual(rookie.challenges.daily.length, 3);
  assert.strictEqual(rookie.challenges.weekly.length, 3);
  assert.deepStrictEqual(rookie.challenges.daily.map((c) => c.id), pro.challenges.daily.map((c) => c.id), 'same challenges for everyone');
  assert.ok(pro.challenges.daily[0].reward > rookie.challenges.daily[0].reward, 'rewards scale with level');
  assert.strictEqual(CH.roll(rookie, now), false, 'no re-roll within the same day');
  assert.strictEqual(CH.roll(rookie, now + 86400000), true, 'new day, new dailies');
  // Force known dailies and complete them all.
  const p = C.newProfile();
  CH.roll(p, now);
  p.challenges.daily = [
    { id: 'perfects', goal: 1, progress: 0, done: false, reward: 100, text: 'a' },
    { id: 'rounds', goal: 1, progress: 0, done: false, reward: 100, text: 'b' },
    { id: 'spot', goal: 1, target: 'Watters Creek Bathrooms', progress: 0, done: false, reward: 100, text: 'c' },
  ];
  const coins = p.coins;
  const a = CH.progress(p, { kick: { distance: 2200, label: 'PERFECT!', target: { name: 'Watters Creek Bathrooms', ring: 'INNER RING' }, padsHit: 0 } }, now);
  assert.deepStrictEqual(a.map((x) => x.text).filter((t) => t !== 'All 3 daily challenges complete!'), ['a', 'c']);
  const b = CH.progress(p, { round: { score: 500 } }, now);
  assert.ok(b.some((x) => x.bonus), 'bonus when all three dailies are done');
  assert.strictEqual(CH.progress(p, { round: { score: 500 } }, now).filter((x) => !x.weekly).length, 0, 'paid once');
  assert.ok(p.coins - coins >= 300);
  // Allen nods are on the map.
  for (const n of ['Market Street', 'Watters Creek Bathrooms', 'Celebration Park', 'Allen Premium Outlets', 'Allen Eagle Stadium']) {
    assert.ok(P.TARGETS.some((t) => t.name === n), n);
  }
});

test('grind rewards: combos, Golden Balls, veteran bonus and crates', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 5, 9, 20].map(C.comboMult), [1, 1, 1.25, 1.5, 2, 3, 3]);
  assert.strictEqual(C.veteranMult(0), 1);
  assert.strictEqual(C.veteranMult(C.xpForLevel(63)), 1.53);
  assert.strictEqual(C.veteranMult(C.xpForLevel(500)), 2.5, 'capped at +150%');
  const p = C.newProfile();
  const plain = C.awardKick(Object.assign(C.newProfile()), 800);
  const hot = C.awardKick(p, 800, { streak: 5, golden: true });
  assert.strictEqual(hot.coins, plain.coins * 2 * C.GOLDEN_MULT);
  let golden = 0;
  for (let i = 0; i < 4000; i++) if (P.isGoldenBall(P.kickSeed(i, i % 10))) golden++;
  assert.ok(golden > 350 && golden < 650, `about 1 in 8 balls are golden (${golden}/4000)`);
  const a = C.newProfile();
  const b = C.newProfile();
  assert.deepStrictEqual(C.openCrate(a, 'round-1'), C.openCrate(b, 'round-1'), 'a round\'s crate is fixed');
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(C.openCrate(C.newProfile(), `r${i}`).id);
  assert.deepStrictEqual([...seen].sort(), ['common', 'epic', 'legendary', 'rare']);
});

test('landmark challenges match the player\'s range', () => {
  const CH = require('../shared/challenges');
  for (let d = 1; d <= 40; d++) {
    const pro = Object.assign(C.newProfile(), { bestKick: 20000 });
    CH.roll(pro, Date.UTC(2026, 9, d, 12));
    const spot = pro.challenges.daily.find((c) => c.id === 'spot');
    if (spot) {
      const t = P.TARGETS.find((x) => x.name === spot.target);
      assert.ok(t.x >= 7000 && t.x <= 18000, `${spot.target} suits a 20 km kicker`);
    }
  }
});
