/* Eggers Kick Off — shop catalogue, levels and rewards (shared by client and server). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EKCatalog = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Ten levels per upgrade. Levels 6-10 are the long-haul goals.
  const UPGRADE_COSTS = [120, 300, 650, 1100, 1700, 2500, 3500, 4800, 6400, 8500];
  const UPGRADE_LEVEL_REQ = [1, 2, 3, 5, 7, 9, 12, 15, 18, 22];
  const MAX_UPGRADE = UPGRADE_COSTS.length;

  const UPGRADES = [
    { id: 'boots', name: 'Power Boots', icon: '👟', desc: 'More kick power: +6% per level, +4% from level 6.' },
    { id: 'ball', name: 'Pro Ball', icon: '⚽', desc: 'Bouncier ball that keeps rolling further.' },
    { id: 'training', name: 'Sweet Spot Training', icon: '🎯', desc: 'Wider sweet spot — easier PERFECT kicks.' },
    { id: 'focus', name: 'Slow-Mo Focus', icon: '⏱️', desc: 'Jason juggles slower, so timing is easier.' },
    { id: 'aero', name: 'Aero Laces', icon: '💨', desc: 'Less air drag on long flights.' },
    { id: 'luck', name: 'Lucky Socks', icon: '🧦', desc: 'More bounce pads, fewer puddles on the field.' },
  ];

  const OUTFITS = [
    { id: 'gi', name: "Jason's Black Gi", cost: 0, level: 1, shirt: '#1c1c1e', shorts: '#1c1c1e', socks: '#1c1c1e', pattern: 'gi', belt: '#f2f2f2', beltTip: '#111111', medal: 'silver', pants: true, longSleeves: true, sandals: true },
    { id: 'tee', name: 'Click Wise Tee', cost: 0, level: 1, shirt: '#047dc3', shorts: '#1b2a3a', socks: '#ffffff' },
    { id: 'polo', name: 'Click Wise Green Polo', cost: 150, level: 1, shirt: '#4caf50', shorts: '#1b2a3a', socks: '#4caf50' },
    { id: 'jersey', name: 'Striker Jersey', cost: 400, level: 3, shirt: '#d32f2f', shorts: '#ffffff', socks: '#d32f2f', pattern: 'stripes', alt: '#ffffff' },
    { id: 'suit', name: 'Client Meeting Suit', cost: 900, level: 5, shirt: '#22304a', shorts: '#22304a', socks: '#111111', pattern: 'suit', alt: '#ffffff', tie: '#c62828', pants: true, longSleeves: true, shoe: '#3e2723' },
    { id: 'whitegi', name: 'Competition White Gi', cost: 1200, level: 6, shirt: '#f4f4f2', shorts: '#f4f4f2', socks: '#f4f4f2', pattern: 'gi', belt: '#1565c0', beltTip: '#111111', medal: 'silver', pants: true, longSleeves: true, sandals: true },
    { id: 'hawaiian', name: 'Friday Hawaiian', cost: 1500, level: 7, shirt: '#ff7043', shorts: '#f5deb3', socks: '#ffffff', pattern: 'flowers', alt: '#ffeb3b' },
    { id: 'ninja', name: 'Night Ninja', cost: 3000, level: 10, shirt: '#263238', shorts: '#263238', socks: '#263238', pattern: 'gi', belt: '#c62828', beltTip: '#c62828', pants: true, longSleeves: true },
    { id: 'referee', name: 'Referee', cost: 3500, level: 11, shirt: '#111111', shorts: '#111111', socks: '#111111', pattern: 'stripes', alt: '#f5f5f5' },
    { id: 'golden', name: 'Golden Boot Kit', cost: 5000, level: 12, shirt: '#ffc107', shorts: '#ffa000', socks: '#ffc107', pattern: 'shine', alt: '#fff8e1' },
    { id: 'blackbelt', name: 'Black Belt Promotion', cost: 6000, level: 14, shirt: '#1c1c1e', shorts: '#1c1c1e', socks: '#1c1c1e', pattern: 'gi', belt: '#111111', beltTip: '#c62828', medal: 'gold', pants: true, longSleeves: true, sandals: true },
    { id: 'astro', name: 'Astronaut', cost: 8000, level: 15, shirt: '#eceff1', shorts: '#cfd8dc', socks: '#90a4ae', pattern: 'astro', alt: '#047dc3', pants: true, longSleeves: true, shoe: '#eceff1' },
    { id: 'tux', name: 'Award Night Tux', cost: 12000, level: 19, shirt: '#0d0d0d', shorts: '#0d0d0d', socks: '#0d0d0d', pattern: 'suit', alt: '#ffffff', tie: '#0d0d0d', pants: true, longSleeves: true, shoe: '#000000' },
    { id: 'coralbelt', name: 'Coral Belt Master', cost: 16000, level: 21, shirt: '#f4f4f2', shorts: '#f4f4f2', socks: '#f4f4f2', pattern: 'gi', belt: '#d32f2f', beltTip: '#111111', medal: 'gold', pants: true, longSleeves: true, sandals: true },
    { id: 'ceo', name: 'Click Wise CEO', cost: 22000, level: 23, shirt: '#047dc3', shorts: '#0b2f4a', socks: '#0b2f4a', pattern: 'suit', alt: '#ffffff', tie: '#4caf50', pants: true, longSleeves: true, shoe: '#111111' },
  ];

  const BALLS = [
    { id: 'classic', name: 'Classic', cost: 0, level: 1, base: '#ffffff', patch: '#222222' },
    { id: 'cw', name: 'Click Wise Ball', cost: 300, level: 2, base: '#047dc3', patch: '#4caf50' },
    { id: 'beach', name: 'Beach Ball', cost: 600, level: 4, base: '#ffffff', patch: '#ff5252', style: 'beach' },
    { id: 'henry', name: 'Henry Ball 🪿', cost: 1000, level: 6, base: '#fffaf0', patch: '#ff8a1c', style: 'henry' },
    { id: 'fire', name: 'Fireball', cost: 1500, level: 8, base: '#ff6d00', patch: '#ffd600', style: 'fire' },
    { id: 'egg', name: 'The Eggers Egg', cost: 2500, level: 10, base: '#fff3d6', patch: '#e0c9a0', style: 'egg' },
    { id: 'gold', name: 'Gold Ball', cost: 4000, level: 12, base: '#ffd54f', patch: '#ff8f00' },
    { id: 'disco', name: 'Disco Ball', cost: 9000, level: 16, base: '#cfd8dc', patch: '#ffffff', style: 'disco' },
    { id: 'planet', name: 'Planet Kick', cost: 20000, level: 24, base: '#ffb74d', patch: '#8d6e63', style: 'planet' },
    { id: 'mastery', name: 'Mastery Pro Ball', cost: 0, level: 1, base: '#0b2f6b', patch: '#ffd54f', style: 'mastery', career: true },
    { id: 'moon', name: 'Moon Ball', cost: 40000, level: 30, base: '#e0e0e0', patch: '#9e9e9e', style: 'moon' },
  ];

  const TRAILS = [
    { id: 'none', name: 'No Trail', cost: 0, level: 1 },
    { id: 'dots', name: 'Dotted Line', cost: 250, level: 2 },
    { id: 'sparkle', name: 'Sparkles', cost: 800, level: 5 },
    { id: 'rainbow', name: 'Rainbow', cost: 2000, level: 9 },
    { id: 'feathers', name: "Henry's Feathers", cost: 4500, level: 13 },
    { id: 'flame', name: 'Flames', cost: 3500, level: 12 },
    { id: 'stars', name: 'Shooting Stars', cost: 9000, level: 17 },
    { id: 'confetti', name: 'Party Confetti', cost: 14000, level: 20 },
    { id: 'comet', name: 'Comet Tail', cost: 25000, level: 25 },
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
    { id: 'perfect', name: 'Perfect Strike', desc: 'Land a PERFECT kick', reward: 150, label: 'PERFECT!' },
    { id: 'target', name: 'On Target', desc: 'Stop the ball in any target', reward: 100, anyTarget: true },
    { id: 'henry', name: "Henry's Friend", desc: 'Stop the ball in the Duck Pond', reward: 250, target: 'Duck Pond' },
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
    return item.cost === 0 || (profile.owned || []).includes(`${slot}:${id}`);
  }

  function levelFromXp(xp) {
    return Math.floor(Math.sqrt(Math.max(0, xp) / 300)) + 1;
  }
  function xpForLevel(level) {
    return 300 * (level - 1) * (level - 1);
  }

  const ROUND_COMPLETION_COINS = 25;
  const POINTS_PER_COIN = 6;
  const FREE_KICK_POINTS_PER_COIN = 8;

  function coinsForRound(score) {
    return Math.floor(score / POINTS_PER_COIN) + ROUND_COMPLETION_COINS;
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
  function coinsForFreeKick(points) {
    return Math.floor(points / FREE_KICK_POINTS_PER_COIN);
  }

  function upgradeCost(level) {
    return UPGRADE_COSTS[level];
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
      const cost = UPGRADE_COSTS[cur];
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
    };
  }

  return {
    UPGRADES, UPGRADE_COSTS, UPGRADE_LEVEL_REQ, MAX_UPGRADE, OUTFITS, BALLS, TRAILS, SLOTS, MILESTONES,
    DEFAULT_EQUIPPED, DEFAULT_OWNED, isOwned,
    ROUND_COMPLETION_COINS, POINTS_PER_COIN, FREE_KICK_POINTS_PER_COIN,
    levelFromXp, xpForLevel, coinsForRound, coinsForFreeKick, levelUpCoins, levelUpBonus,
    checkMilestones, nextUnlocks, upgradeCost,
    applyPurchase, applyEquip, newProfile,
  };
});
