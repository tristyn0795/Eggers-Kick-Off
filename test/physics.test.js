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

test('Power Balls: every 5 PERFECT kicks in a row load one; 9 in a row load the Piñata', () => {
  const perfect = { perfect: true };
  const miss = { perfect: false };
  const run = (n) => Array(n).fill(perfect);
  assert.strictEqual(P.powerBallFor(123, run(4)), null);
  assert.strictEqual(P.powerBallFor(123, [...run(2), miss, ...run(3)]), null);
  assert.ok(P.POWER_IDS.includes(P.powerBallFor(123, [miss, ...run(5)])));
  for (const n of [6, 7, 8]) assert.strictEqual(P.powerBallFor(123, run(n)), null);
  assert.strictEqual(P.powerBallFor(123, run(9)), 'pinata');
  assert.ok(P.POWER_IDS.includes(P.powerBallFor(123, run(10))));
  assert.strictEqual(P.powerBallFor(123, run(18)), 'pinata');
  assert.strictEqual(P.powerBallFor(123, run(45)), 'pinata', 'the piñata wins a tie');
  assert.deepStrictEqual([0, 4, 5, 8, 9, 14, 17].map(P.nextPowerAt), [5, 5, 9, 9, 10, 15, 18]);
  // Every random type turns up across seeds, and never the piñata.
  const seen = new Set();
  for (let s = 0; s < 300; s++) seen.add(P.powerBallFor(s, run(5)));
  assert.deepStrictEqual([...seen].sort(), [...P.POWER_IDS].sort());
});

test('Split Shot and Piñata: deterministic, and the drawn path matches the result', () => {
  for (const L of [0, 10, 50]) {
    const up = { boots: L, ball: L, training: L, focus: L, aero: L, luck: L };
    for (let s = 1; s <= 12; s++) {
      const seed = P.kickSeed(s * 97, 4);
      let frame = 0, best = -1;
      for (let f = 0; f < 240; f++) {
        const d = P.simulateKick(seed, f, up).distance;
        if (d > best) { best = d; frame = f; }
      }
      const base = P.simulateKick(seed, frame, up);
      const split = P.simulateKick(seed, frame, up, { power: 'split' });
      const splitRec = P.simulateKick(seed, frame, up, { power: 'split', record: true });
      assert.strictEqual(split.distance, splitRec.distance, 'server and client agree on the main ball');
      assert.strictEqual(split.split.distance, splitRec.split.distance, 'and on the second ball');
      assert.ok(split.distance < base.distance && split.split.distance < split.distance, 'split balls fly shorter');
      assert.ok(Math.abs(splitRec.path[splitRec.path.length - 2] - splitRec.distance) < 0.2);
      assert.ok(Math.abs(splitRec.splitPath[splitRec.splitPath.length - 2] - splitRec.split.distance) < 0.2);
      assert.ok(P.scoreKick(split, 4, 10) > Math.round(split.distance / 10), 'both balls score');
      const pinata = P.simulateKick(seed, frame, up, { power: 'pinata', record: true });
      assert.strictEqual(pinata.distance, base.distance, 'the piñata flies your full distance');
      assert.strictEqual(pinata.bounces, 0);
      assert.strictEqual(pinata.events[0].type, 'pinata');
    }
  }
});

test('Power Balls change the kick as advertised, at every level', () => {
  for (const L of [0, 10, 50]) {
    const up = { boots: L, ball: L, training: L, focus: L, aero: L, luck: L };
    const seed = P.kickSeed(4242, 3);
    let frame = 0, best = -1;
    for (let f = 0; f < 240; f++) {
      const d = P.simulateKick(seed, f, up).distance;
      if (d > best) { best = d; frame = f; }
    }
    const base = P.simulateKick(seed, frame, up);
    const fire = P.simulateKick(seed, frame, up, { power: 'fire', record: true });
    const bouncy = P.simulateKick(seed, frame, up, { power: 'bouncy', record: true });
    const meteor = P.simulateKick(seed, frame, up, { power: 'meteor', record: true });
    const near = (a, b) => Math.abs(a - b) < 1;
    assert.ok(near(fire.distance, P.BALL_X + (base.distance - P.BALL_X) * 1.35), `fire L${L}`);
    assert.ok(near(bouncy.distance, P.BALL_X + (base.distance - P.BALL_X) * 1.25), `bouncy L${L}`);
    assert.ok(near(meteor.distance, P.BALL_X + (base.distance - P.BALL_X) * 1.45), `meteor L${L}`);
    assert.strictEqual(meteor.bounces, 0);
    assert.strictEqual(meteor.events[0].type, 'crater');
    // The drawn path ends where the result says.
    for (const r of [fire, bouncy, meteor]) assert.ok(near(r.path[r.path.length - 2], r.distance), `${r.power} path end`);
    // Same input, same answer (server and client must agree).
    assert.deepStrictEqual(P.simulateKick(seed, frame, up, { power: 'meteor' }).distance, meteor.distance);
    // Unknown power ids are ignored.
    assert.strictEqual(P.simulateKick(seed, frame, up, { power: 'laser' }).distance, base.distance);
  }
});

test('Magnet Ball pulls a nearby stop into the bullseye', () => {
  let pulled = 0;
  for (let s = 1; s < 400 && pulled < 5; s++) {
    const seed = P.kickSeed(s, 0);
    const base = P.simulateKick(seed, 60, {});
    const mag = P.simulateKick(seed, 60, {}, { power: 'magnet', record: true });
    if (mag.magnetFrom == null) { assert.strictEqual(mag.distance, base.distance); continue; }
    pulled++;
    assert.strictEqual(mag.magnetFrom, base.distance);
    assert.ok(mag.target && mag.target.ring === 'BULLSEYE');
    assert.ok(Math.abs(mag.path[mag.path.length - 2] - mag.distance) < 0.2);
  }
  assert.ok(pulled >= 3, 'found magnet pulls');
});

test('Piñata prizes are fixed by the key and always pay something', () => {
  const C = require('../shared/catalog');
  const base = Object.assign(C.newProfile(), { xp: 30000, coins: 0, upgrades: { boots: 3 } });
  const kinds = new Set();
  for (let i = 0; i < 300; i++) {
    const a = JSON.parse(JSON.stringify(base));
    const b = JSON.parse(JSON.stringify(base));
    const za = C.openPinata(a, `round${i}:9`, Date.UTC(2026, 9, 20));
    const zb = C.openPinata(b, `round${i}:9`, Date.UTC(2026, 9, 20));
    assert.deepStrictEqual(za, zb, 'same key, same prize');
    kinds.add(za.type);
    if (za.type === 'coins') assert.ok(a.coins > 0);
    if (za.type === 'upgrade') assert.strictEqual(a.upgrades[za.id], (base.upgrades[za.id] | 0) + 1);
    if (za.type === 'boost') assert.deepStrictEqual(a.boost, { id: za.id, levels: C.BOOST_LEVELS, rounds: C.BOOST_ROUNDS });
    if (za.type === 'item') {
      assert.ok(a.owned.includes(`${za.slot}:${za.id}`));
      const it = C.SLOTS[za.slot].find((x) => x.id === za.id);
      assert.ok(it.level <= C.levelFromXp(base.xp) + 10, 'no wildly out-of-reach items');
    }
  }
  assert.deepStrictEqual([...kinds].sort(), ['boost', 'coins', 'item', 'upgrade']);
});

test('Piñata boost adds levels for a couple of rounds, then runs out', () => {
  const C = require('../shared/catalog');
  const p = { boost: { id: 'boots', levels: 5, rounds: 2 } };
  assert.deepStrictEqual(C.useBoost(p, { boots: 3 }).upgrades, { boots: 8 });
  assert.deepStrictEqual(C.useBoost(p, { boots: 48 }).upgrades, { boots: 50 }, 'capped at 50');
  assert.strictEqual(p.boost, null);
  assert.deepStrictEqual(C.useBoost(p, { boots: 3 }), { upgrades: { boots: 3 }, boost: null });
});

test('Spooky Season items are only for sale in season, and stay yours after', () => {
  const C = require('../shared/catalog');
  assert.ok(C.seasonActive('halloween', Date.UTC(2026, 9, 1)));
  assert.ok(C.seasonActive('halloween', Date.UTC(2026, 10, 7)));
  assert.ok(!C.seasonActive('halloween', Date.UTC(2026, 10, 8)));
  assert.ok(!C.seasonActive('halloween', Date.UTC(2027, 8, 30)));
  const spooky = [...C.OUTFITS, ...C.BALLS, ...C.TRAILS].filter((i) => i.season === 'halloween').map((i) => i.id).sort();
  assert.deepStrictEqual(spooky, ['bats', 'brew', 'crystal', 'cultist', 'eyeball', 'ghosts', 'hockey', 'jackoball', 'medusa', 'orb', 'pumpkintee', 'skeleton', 'vampire', 'wizard']);
  // The pirate is a year-round outfit.
  assert.ok(!C.OUTFITS.find((o) => o.id === 'pirate').season);
  const p = Object.assign(C.newProfile(), { owned: [...C.DEFAULT_OWNED, 'ball:jackoball'] });
  assert.ok(C.isOwned(p, 'ball', 'jackoball'));
  assert.strictEqual(C.applyEquip(p, 'ball', 'jackoball'), null);
});

test('Halloween items you bought or won are never lost: after the season, through prestige, and in backups', () => {
  const C = require('../shared/catalog');
  const inSeason = Date.UTC(2026, 9, 20);
  const after = Date.UTC(2026, 11, 25);
  const p = Object.assign(C.newProfile(), { xp: 300000, coins: 1e7 });
  // Buy every seasonal item in season.
  const seasonal = [];
  for (const [slot, list] of Object.entries(C.SLOTS)) {
    for (const it of list) if (it.season) seasonal.push([slot, it.id]);
  }
  for (const [slot, id] of seasonal) assert.strictEqual(C.applyPurchase(p, `${slot}:${id}`, inSeason), null, `buy ${id}`);
  // Out of season: can't be bought new, but owners keep and equip them.
  const fresh = Object.assign(C.newProfile(), { xp: 300000, coins: 1e7 });
  assert.match(C.applyPurchase(fresh, 'ball:jackoball', after), /Limited edition/);
  for (const [slot, id] of seasonal) {
    assert.ok(C.isOwned(p, slot, id), `${id} still owned after the season`);
    assert.strictEqual(C.applyEquip(p, slot, id), null, `${id} equippable after the season`);
    assert.strictEqual(C.applyPurchase(p, `${slot}:${id}`, after), 'Already owned');
  }
  // Prestige resets upgrades and coins, never gear.
  p.upgrades = { boots: 50, ball: 50, training: 50, focus: 50, aero: 50, luck: 50 };
  assert.strictEqual(C.applyPrestige(p), null);
  for (const [slot, id] of seasonal) assert.ok(C.isOwned(p, slot, id), `${id} kept through prestige`);
  // Next year the season comes back and it's still yours.
  for (const [slot, id] of seasonal) assert.ok(C.isOwned(p, slot, id));
});

test('Porch Goose: a Medusa Ball stopped at the Duck Pond turns Henry to stone (secret milestone)', () => {
  const C = require('../shared/catalog');
  const pond = { name: 'Duck Pond', ring: 'OUTER RING', points: 25 };
  const medusa = Object.assign(C.newProfile(), { equipped: { outfit: 'gi', ball: 'medusa', trail: 'none' } });
  assert.ok(C.checkMilestones(medusa, { kick: { target: pond, label: 'GOOD', distance: 760 } }).some((m) => m.id === 'porchgoose'));
  const plain = C.newProfile();
  assert.ok(!C.checkMilestones(plain, { kick: { target: pond, label: 'GOOD', distance: 760 } }).some((m) => m.id === 'porchgoose'));
  const elsewhere = Object.assign(C.newProfile(), { equipped: { outfit: 'gi', ball: 'medusa', trail: 'none' } });
  assert.ok(!C.checkMilestones(elsewhere, { kick: { target: { name: 'Car Park', ring: 'BULLSEYE', points: 30 }, label: 'GOOD', distance: 400 } }).some((m) => m.id === 'porchgoose'));
  assert.ok(C.MILESTONES.find((m) => m.id === 'porchgoose').secret, 'stays hidden until found');
});
