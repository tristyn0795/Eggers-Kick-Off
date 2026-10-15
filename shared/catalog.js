/* Eggers Kick Off — shop catalogue, levels and rewards (shared by client and server). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EKCatalog = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const UPGRADE_COSTS = [120, 350, 800, 1600, 3000];
  const UPGRADE_LEVEL_REQ = [1, 2, 4, 6, 9];

  const UPGRADES = [
    { id: 'boots', name: 'Power Boots', icon: '👟', desc: '+6% kick power per level.' },
    { id: 'ball', name: 'Pro Ball', icon: '⚽', desc: 'Bouncier ball that keeps rolling.' },
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
    { id: 'suit', name: 'Client Meeting Suit', cost: 900, level: 5, shirt: '#22304a', shorts: '#22304a', socks: '#111111', pattern: 'suit', alt: '#ffffff' },
    { id: 'hawaiian', name: 'Friday Hawaiian', cost: 1500, level: 7, shirt: '#ff7043', shorts: '#f5deb3', socks: '#ffffff', pattern: 'flowers', alt: '#ffeb3b' },
    { id: 'whitegi', name: 'Competition White Gi', cost: 1200, level: 6, shirt: '#f4f4f2', shorts: '#f4f4f2', socks: '#f4f4f2', pattern: 'gi', belt: '#1565c0', beltTip: '#111111', medal: 'silver', pants: true, longSleeves: true, sandals: true },
    { id: 'blackbelt', name: 'Black Belt Promotion', cost: 6000, level: 14, shirt: '#1c1c1e', shorts: '#1c1c1e', socks: '#1c1c1e', pattern: 'gi', belt: '#111111', beltTip: '#c62828', medal: 'gold', pants: true, longSleeves: true, sandals: true },
    { id: 'golden', name: 'Golden Boot Kit', cost: 5000, level: 12, shirt: '#ffc107', shorts: '#ffa000', socks: '#ffc107', pattern: 'shine', alt: '#fff8e1' },
    { id: 'astro', name: 'Astronaut', cost: 8000, level: 15, shirt: '#eceff1', shorts: '#cfd8dc', socks: '#90a4ae', pattern: 'astro', alt: '#047dc3' },
  ];

  const BALLS = [
    { id: 'classic', name: 'Classic', cost: 0, level: 1, base: '#ffffff', patch: '#222222' },
    { id: 'cw', name: 'Click Wise Ball', cost: 300, level: 2, base: '#047dc3', patch: '#4caf50' },
    { id: 'beach', name: 'Beach Ball', cost: 600, level: 4, base: '#ffffff', patch: '#ff5252', style: 'beach' },
    { id: 'egg', name: 'The Eggers Egg', cost: 2500, level: 10, base: '#fff3d6', patch: '#e0c9a0', style: 'egg' },
    { id: 'fire', name: 'Fireball', cost: 1500, level: 8, base: '#ff6d00', patch: '#ffd600', style: 'fire' },
    { id: 'gold', name: 'Gold Ball', cost: 4000, level: 12, base: '#ffd54f', patch: '#ff8f00' },
  ];

  const TRAILS = [
    { id: 'none', name: 'No Trail', cost: 0, level: 1 },
    { id: 'dots', name: 'Dotted Line', cost: 250, level: 2 },
    { id: 'sparkle', name: 'Sparkles', cost: 800, level: 5 },
    { id: 'rainbow', name: 'Rainbow', cost: 2000, level: 9 },
    { id: 'flame', name: 'Flames', cost: 3500, level: 12 },
  ];

  const SLOTS = { outfit: OUTFITS, ball: BALLS, trail: TRAILS };

  const DEFAULT_EQUIPPED = { outfit: 'gi', ball: 'classic', trail: 'none' };
  const DEFAULT_OWNED = ['outfit:gi', 'outfit:tee', 'ball:classic', 'trail:none'];

  /** Free items are always owned, so new free gear reaches existing players too. */
  function isOwned(profile, slot, id) {
    const item = (SLOTS[slot] || []).find((i) => i.id === id);
    return !!item && (item.cost === 0 || (profile.owned || []).includes(`${slot}:${id}`));
  }

  function levelFromXp(xp) {
    return Math.floor(Math.sqrt(Math.max(0, xp) / 300)) + 1;
  }
  function xpForLevel(level) {
    return 300 * (level - 1) * (level - 1);
  }

  function coinsForRound(score) {
    return Math.floor(score / 6) + 25;
  }
  function coinsForFreeKick(points) {
    return Math.floor(points / 8);
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
      if (cur >= 5) return 'Already maxed out';
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
    };
  }

  return {
    UPGRADES, UPGRADE_COSTS, UPGRADE_LEVEL_REQ, OUTFITS, BALLS, TRAILS, SLOTS,
    DEFAULT_EQUIPPED, DEFAULT_OWNED, isOwned,
    levelFromXp, xpForLevel, coinsForRound, coinsForFreeKick, upgradeCost,
    applyPurchase, applyEquip, newProfile,
  };
});
