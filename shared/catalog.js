/* Eggers Kick Off — shop catalogue, levels and rewards (shared by client and server). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EKCatalog = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Ten levels per upgrade. Each level costs UPGRADE_GROWTH× the last, so the
  // first few come quickly and levels 6-10 are a long grind.
  const UPGRADE_BASE = 250;
  const UPGRADE_GROWTH = 1.6;
  const UPGRADE_LATE_GROWTH = 1.035; // from level 10 on, each level costs 3.5% more than the last
  const MAX_UPGRADE = 50;
  // Player level needed to buy upgrade level i+1. Levels 1-10 unchanged; then +2 player levels per upgrade level.
  const UPGRADE_LEVEL_REQ = [1, 2, 3, 5, 7, 9, 12, 15, 18, 22];
  while (UPGRADE_LEVEL_REQ.length < MAX_UPGRADE) UPGRADE_LEVEL_REQ.push(UPGRADE_LEVEL_REQ[UPGRADE_LEVEL_REQ.length - 1] + 2);

  const UPGRADES = [
    { id: 'boots', name: 'Power Boots', icon: '👟', price: 1.25, desc: 'More kick power: +6% per level, +4% from level 6.' },
    { id: 'ball', name: 'Pro Ball', icon: '⚽', price: 1.25, desc: 'Bouncier ball that keeps rolling further.' },
    { id: 'training', name: 'Sweet Spot Training', icon: '🎯', price: 1.0, desc: 'Wider sweet spot — easier PERFECT kicks.' },
    { id: 'focus', name: 'Slow-Mo Focus', icon: '⏱️', price: 0.85, desc: 'Jason juggles slower, so timing is easier.' },
    { id: 'aero', name: 'Aero Laces', icon: '💨', price: 1.0, desc: 'Less air drag on long flights.' },
    { id: 'luck', name: 'Lucky Socks', icon: '🧦', price: 0.9, desc: 'More bounce pads, fewer puddles on the field.' },
  ];

  /** Coins to buy the upgrade's next level when it's currently at `level`. */
  function upgradeCost(id, level) {
    const up = UPGRADES.find((u) => u.id === id);
    const early = Math.min(level, 9);
    const raw = UPGRADE_BASE * (up ? up.price : 1) * Math.pow(UPGRADE_GROWTH, early)
      * Math.pow(UPGRADE_LATE_GROWTH, Math.max(0, level - 9));
    if (raw < 1000) return Math.round(raw / 10) * 10;
    return level < 10 ? Math.round(raw / 50) * 50 : Math.round(raw / 100) * 100;
  }

  const OUTFITS = [
    { id: 'gi', name: "Jason's Black Gi", cost: 0, level: 1, shirt: '#1c1c1e', shorts: '#1c1c1e', socks: '#1c1c1e', pattern: 'gi', belt: '#f2f2f2', beltTip: '#111111', medal: 'silver', pants: true, longSleeves: true, sandals: true },
    { id: 'tee', name: 'Click Wise Tee', cost: 0, level: 1, shirt: '#047dc3', shorts: '#1b2a3a', socks: '#ffffff' },
    { id: 'polo', name: 'Click Wise Green Polo', cost: 400, level: 1, shirt: '#4caf50', shorts: '#1b2a3a', socks: '#4caf50' },
    { id: 'jersey', name: 'Striker Jersey', cost: 1000, level: 3, shirt: '#d32f2f', shorts: '#ffffff', socks: '#d32f2f', pattern: 'stripes', alt: '#ffffff' },
    { id: 'suit', name: 'Client Meeting Suit', cost: 2200, level: 5, shirt: '#22304a', shorts: '#22304a', socks: '#111111', pattern: 'suit', alt: '#ffffff', tie: '#c62828', pants: true, longSleeves: true, shoe: '#3e2723' },
    { id: 'whitegi', name: 'Competition White Gi', cost: 3000, level: 6, shirt: '#f4f4f2', shorts: '#f4f4f2', socks: '#f4f4f2', pattern: 'gi', belt: '#1565c0', beltTip: '#111111', medal: 'silver', pants: true, longSleeves: true, sandals: true },
    { id: 'hawaiian', name: 'Friday Hawaiian', cost: 3800, level: 7, shirt: '#ff7043', shorts: '#f5deb3', socks: '#ffffff', pattern: 'flowers', alt: '#ffeb3b' },
    { id: 'ninja', name: 'Night Ninja', cost: 7500, level: 10, shirt: '#263238', shorts: '#263238', socks: '#263238', pattern: 'gi', belt: '#c62828', beltTip: '#c62828', pants: true, longSleeves: true },
    { id: 'referee', name: 'Referee', cost: 8500, level: 11, shirt: '#111111', shorts: '#111111', socks: '#111111', pattern: 'stripes', alt: '#f5f5f5' },
    { id: 'golden', name: 'Golden Boot Kit', cost: 12000, level: 12, shirt: '#ffc107', shorts: '#ffa000', socks: '#ffc107', pattern: 'shine', alt: '#fff8e1' },
    { id: 'blackbelt', name: 'Black Belt Promotion', cost: 15000, level: 14, shirt: '#1c1c1e', shorts: '#1c1c1e', socks: '#1c1c1e', pattern: 'gi', belt: '#111111', beltTip: '#c62828', medal: 'gold', pants: true, longSleeves: true, sandals: true },
    { id: 'astro', name: 'Astronaut', cost: 20000, level: 15, shirt: '#eceff1', shorts: '#cfd8dc', socks: '#90a4ae', pattern: 'astro', alt: '#047dc3', pants: true, longSleeves: true, shoe: '#eceff1' },
    { id: 'tux', name: 'Award Night Tux', cost: 30000, level: 19, shirt: '#0d0d0d', shorts: '#0d0d0d', socks: '#0d0d0d', pattern: 'suit', alt: '#ffffff', tie: '#0d0d0d', pants: true, longSleeves: true, shoe: '#000000' },
    { id: 'coralbelt', name: 'Coral Belt Master', cost: 40000, level: 21, shirt: '#f4f4f2', shorts: '#f4f4f2', socks: '#f4f4f2', pattern: 'gi', belt: '#d32f2f', beltTip: '#111111', medal: 'gold', pants: true, longSleeves: true, sandals: true },
    { id: 'ceo', name: 'Click Wise CEO', cost: 55000, level: 23, shirt: '#047dc3', shorts: '#0b2f4a', socks: '#0b2f4a', pattern: 'suit', alt: '#ffffff', tie: '#4caf50', pants: true, longSleeves: true, shoe: '#111111' },
    { id: 'platinumgi', name: 'Platinum Gi', cost: 0, level: 1, prestige: 3, shirt: '#e5e4e2', shorts: '#e5e4e2', socks: '#e5e4e2', pattern: 'gi', belt: '#7e57c2', beltTip: '#111111', medal: 'gold', pants: true, longSleeves: true, sandals: true },
    { id: 'legendgi', name: 'Eggers Legend Gi', cost: 400000, level: 50, shirt: '#ffd54f', shorts: '#ffd54f', socks: '#ffd54f', pattern: 'gi', belt: '#111111', beltTip: '#c62828', medal: 'gold', pants: true, longSleeves: true, sandals: true },
    { id: 'cosmicsuit', name: 'Cosmic Suit', cost: 2000000, level: 100, shirt: '#311b92', shorts: '#1a237e', socks: '#1a237e', pattern: 'suit', alt: '#b388ff', tie: '#ffd54f', pants: true, longSleeves: true, shoe: '#000000' },
  ];

  const BALLS = [
    { id: 'classic', name: 'Classic', cost: 0, level: 1, base: '#ffffff', patch: '#222222' },
    { id: 'cw', name: 'Click Wise Ball', cost: 750, level: 2, base: '#047dc3', patch: '#4caf50' },
    { id: 'beach', name: 'Beach Ball', cost: 1500, level: 4, base: '#ffffff', patch: '#ff5252', style: 'beach' },
    { id: 'henry', name: 'Henry Ball 🪿', cost: 2500, level: 6, base: '#fffaf0', patch: '#ff8a1c', style: 'henry' },
    { id: 'fire', name: 'Fireball', cost: 3800, level: 8, base: '#ff6d00', patch: '#ffd600', style: 'fire' },
    { id: 'egg', name: 'The Eggers Egg', cost: 6000, level: 10, base: '#fff3d6', patch: '#e0c9a0', style: 'egg' },
    { id: 'gold', name: 'Gold Ball', cost: 10000, level: 12, base: '#ffd54f', patch: '#ff8f00' },
    { id: 'disco', name: 'Disco Ball', cost: 22000, level: 16, base: '#cfd8dc', patch: '#ffffff', style: 'disco' },
    { id: 'planet', name: 'Planet Kick', cost: 50000, level: 24, base: '#ffb74d', patch: '#8d6e63', style: 'planet' },
    { id: 'mastery', name: 'Mastery Pro Ball', cost: 0, level: 1, base: '#0b2f6b', patch: '#ffd54f', style: 'mastery', career: true },
    { id: 'moon', name: 'Moon Ball', cost: 100000, level: 30, base: '#e0e0e0', patch: '#9e9e9e', style: 'moon' },
    { id: 'star', name: 'Prestige Star Ball', cost: 0, level: 1, prestige: 1, base: '#fffdf5', patch: '#ffc107', style: 'star' },
    { id: 'diamond', name: 'Diamond Ball', cost: 0, level: 1, prestige: 5, base: '#b2ebf2', patch: '#ffffff', style: 'diamond' },
    { id: 'galaxy', name: 'Galaxy Ball', cost: 250000, level: 40, base: '#1a0b3d', patch: '#b388ff', style: 'galaxy' },
    { id: 'blackhole', name: 'Black Hole Ball', cost: 1000000, level: 80, base: '#000000', patch: '#ff9100', style: 'blackhole' },
  ];

  const TRAILS = [
    { id: 'none', name: 'No Trail', cost: 0, level: 1 },
    { id: 'dots', name: 'Dotted Line', cost: 600, level: 2 },
    { id: 'sparkle', name: 'Sparkles', cost: 2000, level: 5 },
    { id: 'rainbow', name: 'Rainbow', cost: 5000, level: 9 },
    { id: 'feathers', name: "Henry's Feathers", cost: 11000, level: 13 },
    { id: 'flame', name: 'Flames', cost: 9000, level: 12 },
    { id: 'stars', name: 'Shooting Stars', cost: 22000, level: 17 },
    { id: 'confetti', name: 'Party Confetti', cost: 35000, level: 20 },
    { id: 'comet', name: 'Comet Tail', cost: 60000, level: 25 },
    { id: 'aura', name: 'Prestige Aura', cost: 0, level: 1, prestige: 2 },
    { id: 'supernova', name: 'Supernova', cost: 0, level: 1, prestige: 10 },
    { id: 'cosmic', name: 'Cosmic Dust', cost: 500000, level: 60 },
  ];

  // One-time rewards. Checked after every kick and every round.
  const MILESTONES = [
    { id: 'k500', name: 'First Big Boot', desc: 'Kick 500 m', reward: 100, kick: 500 },
    { id: 'k1000', name: 'Kilometre Club', desc: 'Kick 1,000 m', reward: 200, kick: 1000 },
    { id: 'k2000', name: 'Two-K Toe', desc: 'Kick 2,000 m', reward: 400, kick: 2000 },
    { id: 'k3000', name: 'Gas Station Getaway', desc: 'Kick 3,000 m', reward: 600, kick: 3000 },
    { id: 'office', name: 'Clocked In', desc: 'Kick 4,000 m to reach the Click Wise office', reward: 1000, kick: 4000 },
    { id: 'k6000', name: 'Cross-Town Kick', desc: 'Kick 6,000 m', reward: 1500, kick: 6000 },
    { id: 'k8000', name: 'Mountain Mover', desc: 'Kick 8,000 m', reward: 2500, kick: 8000 },
    { id: 'k10000', name: 'Ten-K Legend', desc: 'Kick 10,000 m', reward: 4000, kick: 10000 },
    { id: 'k13000', name: 'Volcano Vaulter', desc: 'Kick 13,000 m', reward: 6000, kick: 13000 },
    { id: 'k17000', name: 'Moonshot', desc: 'Kick 17,000 m to the Moon Base', reward: 10000, kick: 17000 },
    { id: 'k25000', name: 'Oasis Express', desc: 'Kick 25,000 m', reward: 15000, kick: 25000 },
    { id: 'k35000', name: 'Castle Crusher', desc: 'Kick 35,000 m', reward: 25000, kick: 35000 },
    { id: 'k45000', name: 'Stadium Sender', desc: 'Kick 45,000 m', reward: 40000, kick: 45000 },
    { id: 'k60000', name: 'Event Horizon', desc: 'Kick 60,000 m to the Black Hole', reward: 75000, kick: 60000 },
    { id: 'k68000', name: 'Galaxy Brain', desc: 'Kick 68,000 m to the Eggers Galaxy HQ', reward: 120000, kick: 68000 },
    { id: 'up25', name: 'Halfway Hero', desc: 'Get any upgrade to level 25', reward: 20000, upgrade: 25 },
    { id: 'up50', name: 'Maxed Out', desc: 'Get any upgrade to level 50', reward: 150000, upgrade: 50 },
    { id: 'r50000', name: 'Galactic Round', desc: 'Score 50,000 in one round', reward: 20000, round: 50000 },
    { id: 'r100000', name: 'Cosmic Round', desc: 'Score 100,000 in one round', reward: 60000, round: 100000 },
    { id: 'pr1', name: 'Born Again', desc: 'Prestige for the first time', reward: 5000, prestige: 1 },
    { id: 'pr5', name: 'Five Star Kicker', desc: 'Reach prestige 5', reward: 50000, prestige: 5 },
    { id: 'pr10', name: 'Prestige Legend', desc: 'Reach prestige 10', reward: 200000, prestige: 10 },
    { id: 'perfect', name: 'Perfect Strike', desc: 'Land a PERFECT kick', reward: 150, label: 'PERFECT!' },
    { id: 'target', name: 'On Target', desc: 'Stop the ball in any target', reward: 100, anyTarget: true },
    { id: 'henry', name: "Henry's Friend", desc: 'Stop the ball in the Duck Pond', reward: 250, target: 'Duck Pond' },
    { id: 'restroom', name: 'Nature Calls', desc: 'Stop the ball at the Watters Creek Bathrooms', reward: 400, target: 'Watters Creek Bathrooms' },
    { id: 'groceries', name: 'Grocery Run', desc: 'Stop the ball at Market Street', reward: 150, target: 'Market Street' },
    { id: 'bullseye', name: 'Bullseye!', desc: 'Stop the ball in any bullseye', reward: 300, ring: 'BULLSEYE' },
    { id: 'corner', name: 'Corner Office', desc: 'Bullseye the Click Wise Design Office', reward: 3000, target: 'Click Wise Design Office', ring: 'BULLSEYE' },
    { id: 'r2000', name: 'Solid Round', desc: 'Score 2,000 in one round', reward: 300, round: 2000 },
    { id: 'r5000', name: 'Big Round', desc: 'Score 5,000 in one round', reward: 1000, round: 5000 },
    { id: 'r10000', name: 'Monster Round', desc: 'Score 10,000 in one round', reward: 3000, round: 10000 },
    { id: 'r20000', name: 'Legendary Round', desc: 'Score 20,000 in one round', reward: 8000, round: 20000 },
    { id: 'p10', name: 'Regular', desc: 'Finish 10 rounds', reward: 500, rounds: 10 },
    { id: 'p50', name: 'Office Favourite', desc: 'Finish 50 rounds', reward: 2500, rounds: 50 },
    { id: 'p200', name: 'Kick Off Veteran', desc: 'Finish 200 rounds', reward: 10000, rounds: 200 },
  ];

  const SLOTS = { outfit: OUTFITS, ball: BALLS, trail: TRAILS };

  const DEFAULT_EQUIPPED = { outfit: 'gi', ball: 'classic', trail: 'none' };
  const DEFAULT_OWNED = ['outfit:gi', 'outfit:tee', 'ball:classic', 'trail:none'];

  /** Free items are always owned, so new free gear reaches existing players too. */
  function isOwned(profile, slot, id) {
    const item = (SLOTS[slot] || []).find((i) => i.id === id);
    if (!item) return false;
    if (item.career) return !!(profile.career && profile.career.pro);
    if (item.prestige) return (profile.prestige | 0) >= item.prestige;
    return item.cost === 0 || (profile.owned || []).includes(`${slot}:${id}`);
  }

  function levelFromXp(xp) {
    return Math.floor(Math.sqrt(Math.max(0, xp) / 300)) + 1;
  }
  function xpForLevel(level) {
    return 300 * (level - 1) * (level - 1);
  }

  // Coins are paid after every kick (1 per POINTS_PER_COIN points) so the wallet ticks up as you play,
  // plus a completion bonus, a daily streak bonus and level-up bonuses.
  const ROUND_COMPLETION_COINS = 20;
  const POINTS_PER_COIN = 8;
  const FREE_KICK_POINTS_PER_COIN = 10;
  const DAILY_BONUS_PER_DAY = 50;
  const DAILY_BONUS_MAX_DAYS = 7;

  function coinsForKick(points) {
    return Math.floor(Math.max(0, points) / POINTS_PER_COIN);
  }
  /** Whole-round equivalent (per-kick coins + completion bonus). */
  function coinsForRound(score) {
    return Math.floor(score / POINTS_PER_COIN) + ROUND_COMPLETION_COINS;
  }

  // ---- Kick rewards --------------------------------------------------------
  const GOLDEN_MULT = 4;            // Golden Balls pay ×4 coins
  const COMBO_STEP = 0.25;          // each GREAT/PERFECT in a row adds +0.25× ...
  const COMBO_MAX = 3;              // ... up to ×3
  const VETERAN_FROM_LEVEL = 10;    // +1% coins per player level above 10 ...
  const VETERAN_MAX = 1.5;          // ... up to +150%

  /** Coin multiplier for a run of consecutive good kicks (streak counts this kick). */
  function comboMult(streak) {
    return Math.min(COMBO_MAX, 1 + COMBO_STEP * Math.max(0, (streak | 0) - 1));
  }
  function veteranMult(xp) {
    return 1 + Math.min(VETERAN_MAX, Math.max(0, levelFromXp(xp || 0) - VETERAN_FROM_LEVEL) * 0.01);
  }
  /** A kick that keeps a combo going. */
  function isGoodKick(result) {
    return !result.whiff && result.quality >= 0.8;
  }

  /**
   * Pay out one kick: coins and XP land immediately, and any level-up bonus with them.
   * opts: { freeKick, streak (good kicks in a row including this one, 0 if this one wasn't good), golden }.
   * Mutates the profile and returns what was paid.
   */
  function awardKick(profile, points, opts) {
    opts = opts || {};
    const baseCoins = opts.freeKick ? Math.floor(Math.max(0, points) / FREE_KICK_POINTS_PER_COIN) : coinsForKick(points);
    const combo = comboMult(opts.streak);
    const golden = opts.golden ? GOLDEN_MULT : 1;
    const veteran = veteranMult(profile.xp);
    const coins = Math.floor(baseCoins * prestigeCoinMult(profile.prestige) * veteran * combo * golden);
    const xp = opts.freeKick ? Math.floor(points / 2) : points;
    const levelBefore = levelFromXp(profile.xp);
    profile.xp += xp;
    const levelAfter = levelFromXp(profile.xp);
    const levelBonus = levelUpBonus(levelBefore, levelAfter);
    profile.coins += coins + levelBonus;
    return { coins, baseCoins, xp, levelBefore, levelAfter, levelBonus, combo, golden: !!opts.golden, veteran, streak: opts.streak | 0 };
  }

  // ---- Kick Crates: a prize at the end of every finished round ---------------
  const CRATES = [
    { id: 'common', name: 'Common Crate', icon: '📦', chance: 0.6, mult: 1 },
    { id: 'rare', name: 'Rare Crate', icon: '🎁', chance: 0.3, mult: 3 },
    { id: 'epic', name: 'Epic Crate', icon: '💜', chance: 0.09, mult: 8 },
    { id: 'legendary', name: 'Legendary Crate', icon: '👑', chance: 0.01, mult: 25 },
  ];

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /** Open this round's crate (fixed by the round, so it can't be re-rolled). Pays the profile. */
  function openCrate(profile, roundKey) {
    let x = hashString(String(roundKey));
    x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b); x ^= x >>> 16;
    const roll = (x >>> 0) / 4294967296;
    let acc = 0;
    let crate = CRATES[0];
    for (const c of CRATES) { acc += c.chance; if (roll < acc) { crate = c; break; } }
    const level = levelFromXp(profile.xp || 0);
    const coins = Math.round(((60 + 25 * level) * crate.mult * prestigeCoinMult(profile.prestige)) / 10) * 10;
    profile.coins += coins;
    return { id: crate.id, name: crate.name, icon: crate.icon, coins };
  }

  function utcDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  /** First finished round of each (UTC) day pays a bonus that grows with your streak. */
  function applyDaily(profile, now) {
    const today = utcDay(now == null ? Date.now() : now);
    const d = profile.daily || {};
    if (d.last === today) return { bonus: 0, streak: d.streak || 1, already: true };
    const yesterday = utcDay((now == null ? Date.now() : now) - 86400000);
    const streak = d.last === yesterday ? (d.streak || 0) + 1 : 1;
    const bonus = DAILY_BONUS_PER_DAY * Math.min(streak, DAILY_BONUS_MAX_DAYS);
    profile.daily = { last: today, streak };
    profile.coins += bonus;
    return { bonus, streak, already: false };
  }

  /** Coins for reaching `level` (paid once per level gained). */
  function levelUpCoins(level) {
    return 50 + 25 * level;
  }
  function levelUpBonus(before, after) {
    let total = 0;
    for (let l = before + 1; l <= after; l++) total += levelUpCoins(l);
    return total;
  }

  /**
   * Award any milestones newly met. `ev` may hold `kick` (a kick result) and/or
   * `roundScore`. Mutates the profile (milestones + coins) and returns what was earned.
   */
  function checkMilestones(profile, ev) {
    const have = new Set(profile.milestones || []);
    const earned = [];
    for (const m of MILESTONES) {
      if (have.has(m.id)) continue;
      let ok = false;
      if (m.kick) ok = (profile.bestKick || 0) >= m.kick;
      else if (m.prestige) ok = (profile.prestige | 0) >= m.prestige;
      else if (m.upgrade) ok = Object.values(profile.upgrades || {}).some((v) => (v | 0) >= m.upgrade);
      else if (m.round) ok = (profile.bestRound || 0) >= m.round || (ev.roundScore || 0) >= m.round;
      else if (m.rounds) ok = (profile.roundsPlayed || 0) >= m.rounds;
      else if (ev.kick) {
        const k = ev.kick;
        const t = k.target;
        if (m.label) ok = k.label === m.label;
        else if (m.anyTarget) ok = !!t;
        else if (m.target && m.ring) ok = !!t && t.name === m.target && t.ring === m.ring;
        else if (m.target) ok = !!t && t.name === m.target;
        else if (m.ring) ok = !!t && t.ring === m.ring;
      }
      if (ok) {
        have.add(m.id);
        earned.push({ id: m.id, name: m.name, reward: m.reward });
        profile.coins += m.reward;
      }
    }
    profile.milestones = [...have];
    return earned;
  }

  /** What the player unlocks at the next level that has something new. */
  function nextUnlocks(level) {
    for (let L = level + 1; L <= level + 15; L++) {
      const items = [];
      for (const [slot, list] of Object.entries(SLOTS)) {
        for (const it of list) if (it.level === L) items.push(it.name);
      }
      UPGRADE_LEVEL_REQ.forEach((req, i) => { if (req === L && i > 0) items.push(`Upgrade level ${i + 1}`); });
      if (items.length) return { level: L, items };
    }
    return null;
  }
  // ---- Prestige ------------------------------------------------------------
  // Reset upgrades and coins for permanent bonuses. Level, cosmetics, milestones,
  // career and records are kept.
  const PRESTIGE_BASE_REQ = 150;      // total upgrade levels needed for the first prestige
  const PRESTIGE_REQ_STEP = 30;       // ...and this many more for each one after
  const PRESTIGE_COIN_BONUS = 0.1;    // +10% coins per prestige
  const PRESTIGE_POWER_BONUS = 0.02;  // +2% kick power per prestige (applied in physics)
  const PRESTIGE_START_COINS = 1000;  // starter coins × new prestige rank
  const MAX_PRESTIGE = 99;

  function totalUpgradeLevels(profile) {
    return UPGRADES.reduce((n, u) => n + ((profile.upgrades && profile.upgrades[u.id]) | 0), 0);
  }
  function prestigeRequirement(prestige) {
    return Math.min(MAX_UPGRADE * UPGRADES.length, PRESTIGE_BASE_REQ + PRESTIGE_REQ_STEP * (prestige | 0));
  }
  function prestigeCoinMult(prestige) {
    return 1 + PRESTIGE_COIN_BONUS * Math.max(0, Math.min(MAX_PRESTIGE, prestige | 0));
  }
  function prestigeRewardsAt(rank) {
    return Object.entries(SLOTS).flatMap(([, list]) => list.filter((i) => i.prestige === rank).map((i) => i.name));
  }
  /** Prestige the profile. Returns an error string, or null on success. */
  function applyPrestige(profile) {
    const rank = profile.prestige | 0;
    if (rank >= MAX_PRESTIGE) return 'You have reached the maximum prestige';
    const need = prestigeRequirement(rank);
    if (totalUpgradeLevels(profile) < need) return `You need ${need} total upgrade levels to prestige`;
    profile.prestige = rank + 1;
    profile.upgrades = {};
    profile.coins = PRESTIGE_START_COINS * profile.prestige;
    return null;
  }

  /** Validate and apply a purchase to a profile object. Returns an error string or null. */
  function applyPurchase(profile, itemKey) {
    const level = levelFromXp(profile.xp);
    const [kind, id] = String(itemKey || '').split(':');
    if (kind === 'upgrade') {
      const up = UPGRADES.find((u) => u.id === id);
      if (!up) return 'Unknown upgrade';
      const cur = (profile.upgrades && profile.upgrades[id]) | 0;
      if (cur >= MAX_UPGRADE) return 'Already maxed out';
      if (level < UPGRADE_LEVEL_REQ[cur]) return `Reach level ${UPGRADE_LEVEL_REQ[cur]} first`;
      const cost = upgradeCost(id, cur);
      if (profile.coins < cost) return 'Not enough coins';
      profile.coins -= cost;
      profile.upgrades = Object.assign({}, profile.upgrades, { [id]: cur + 1 });
      return null;
    }
    const list = SLOTS[kind];
    if (!list) return 'Unknown item';
    const item = list.find((i) => i.id === id);
    if (!item) return 'Unknown item';
    const key = `${kind}:${id}`;
    if (isOwned(profile, kind, id)) return 'Already owned';
    if (item.career) return 'Earn this by going Pro in Career mode';
    if (item.prestige) return `Reach prestige ⭐${item.prestige} to unlock this`;
    if (level < item.level) return `Reach level ${item.level} first`;
    if (profile.coins < item.cost) return 'Not enough coins';
    profile.coins -= item.cost;
    profile.owned = (profile.owned || []).concat(key);
    profile.equipped = Object.assign({}, profile.equipped, { [kind]: id });
    return null;
  }

  function applyEquip(profile, slot, id) {
    if (!SLOTS[slot]) return 'Unknown slot';
    if (!isOwned(profile, slot, id)) return 'You do not own that yet';
    profile.equipped = Object.assign({}, profile.equipped, { [slot]: id });
    return null;
  }

  function newProfile() {
    return {
      coins: 0,
      xp: 0,
      upgrades: {},
      owned: DEFAULT_OWNED.slice(),
      equipped: Object.assign({}, DEFAULT_EQUIPPED),
      bestRound: 0,
      bestKick: 0,
      roundsPlayed: 0,
      milestones: [],
      daily: {},
      prestige: 0,
    };
  }

  return {
    UPGRADES, UPGRADE_LEVEL_REQ, MAX_UPGRADE, UPGRADE_BASE, UPGRADE_GROWTH, OUTFITS, BALLS, TRAILS, SLOTS, MILESTONES,
    DEFAULT_EQUIPPED, DEFAULT_OWNED, isOwned,
    ROUND_COMPLETION_COINS, POINTS_PER_COIN, FREE_KICK_POINTS_PER_COIN, DAILY_BONUS_PER_DAY, DAILY_BONUS_MAX_DAYS,
    levelFromXp, xpForLevel, coinsForKick, coinsForRound, levelUpCoins, levelUpBonus,
    awardKick, applyDaily, checkMilestones, nextUnlocks, upgradeCost, UPGRADE_LATE_GROWTH,
    PRESTIGE_BASE_REQ, PRESTIGE_REQ_STEP, PRESTIGE_COIN_BONUS, PRESTIGE_POWER_BONUS, PRESTIGE_START_COINS, MAX_PRESTIGE,
    totalUpgradeLevels, prestigeRequirement, prestigeCoinMult, prestigeRewardsAt, applyPrestige,
    GOLDEN_MULT, COMBO_STEP, COMBO_MAX, VETERAN_FROM_LEVEL, VETERAN_MAX, CRATES,
    comboMult, veteranMult, isGoodKick, openCrate,
    applyPurchase, applyEquip, newProfile,
  };
});
