/*
 * Eggers Kick Off — Career mode (modelled on Wii Sports).
 *
 * You climb a ladder of bosses. Every match is 10 kicks on the same field as
 * the boss. Wins raise your Skill Level, losses lower it, and reaching
 * PRO_SKILL (1,000) earns the Mastery Pro Ball. Shared by client and server so
 * both compute identical boss scores.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics'));
  else root.EKCareer = factory(root.EKPhysics);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';

  const PRO_SKILL = 1000;
  const MAX_SKILL = 2500;
  const CPU_FRAMES = 240;
  const HISTORY = 20;

  const TIERS = [
    { id: 'amateur', name: 'Amateur League', color: '#4caf50' },
    { id: 'semipro', name: 'Semi-Pro Circuit', color: '#047dc3' },
    { id: 'pro', name: 'Pro Tour', color: '#8e24aa' },
    { id: 'legend', name: 'Legends', color: '#ff8f00' },
  ];

  // gear = upgrade level on every upgrade; accuracy = how close to their best kick they get.
  const BOSSES = [
    { id: 'henry', name: 'Henry the Duck', avatar: '🪿', tier: 'amateur', rating: 100, gear: 0, accuracy: 0.3, reward: 150, taunt: 'Quack. That means "good luck".' },
    { id: 'ivy', name: 'Intern Ivy', avatar: '🧑‍💻', tier: 'amateur', rating: 200, gear: 0, accuracy: 0.5, reward: 250, taunt: 'I watched a YouTube tutorial on this.' },
    { id: 'carl', name: 'Coach Carl', avatar: '🧢', tier: 'amateur', rating: 320, gear: 1, accuracy: 0.6, reward: 400, taunt: 'Plant foot! Follow through! Hustle!' },
    { id: 'pete', name: 'Pizza Pete', avatar: '🍕', tier: 'semipro', rating: 450, gear: 2, accuracy: 0.65, reward: 600, taunt: 'Extra cheese, extra distance.' },
    { id: 'betty', name: 'Billboard Betty', avatar: '📣', tier: 'semipro', rating: 580, gear: 3, accuracy: 0.7, reward: 800, taunt: 'Your name will never be on my billboard.' },
    { id: 'kilo', name: 'Captain Kilometre', avatar: '🦸', tier: 'semipro', rating: 720, gear: 4, accuracy: 0.75, reward: 1100, taunt: 'I measure my kicks in kilometres.' },
    { id: 'dana', name: 'Downtown Dana', avatar: '🏙️', tier: 'pro', rating: 860, gear: 5, accuracy: 0.8, reward: 1500, taunt: 'I kick from rooftop to rooftop.' },
    { id: 'sensei', name: 'The Sensei', avatar: '🥋', tier: 'pro', rating: 1000, gear: 6, accuracy: 0.84, reward: 2000, taunt: 'Jason… your gi is not ready.' },
    { id: 'ace', name: 'Air Marshal Ace', avatar: '✈️', tier: 'pro', rating: 1150, gear: 7, accuracy: 0.88, reward: 2600, taunt: 'Cleared for take-off. You are not.' },
    { id: 'mo', name: 'Mountain Mo', avatar: '🏔️', tier: 'legend', rating: 1300, gear: 8, accuracy: 0.9, reward: 3500, taunt: 'The air is thin up here.' },
    { id: 'vic', name: 'Volcano Vic', avatar: '🌋', tier: 'legend', rating: 1500, gear: 9, accuracy: 0.93, reward: 5000, taunt: 'My kicks erupt.' },
    { id: 'max', name: 'Moon Boss Max', avatar: '🌕', tier: 'legend', rating: 1800, gear: 10, accuracy: 0.97, reward: 10000, taunt: 'One small kick for me…' },
  ];

  function newCareer() {
    return { skill: 0, beaten: [], history: [0], matches: 0, wins: 0, pro: false };
  }

  function normalize(c) {
    return Object.assign(newCareer(), c || {});
  }

  function bossById(id) {
    return BOSSES.find((b) => b.id === id) || null;
  }

  /** A boss is open once the one before it has been beaten. */
  function isUnlocked(career, bossId) {
    const i = BOSSES.findIndex((b) => b.id === bossId);
    if (i < 0) return false;
    return i === 0 || (career.beaten || []).includes(BOSSES[i - 1].id);
  }

  function gearFor(boss) {
    const L = boss.gear;
    return { boots: L, ball: L, training: L, focus: L, aero: L, luck: L };
  }

  /** The boss's 10 kicks for a round seed. Deterministic. */
  function cpuRound(baseSeed, boss) {
    const gear = gearFor(boss);
    const rng = P.mulberry32(P.hashSeed(baseSeed >>> 0, P.hashSeed(boss.rating, 0xB055)));
    const kicks = [];
    let total = 0;
    for (let i = 0; i < P.KICKS_PER_ROUND; i++) {
      const seed = P.kickSeed(baseSeed, i);
      const options = [];
      for (let f = 0; f < CPU_FRAMES; f++) options.push(f);
      const dist = options.map((f) => P.simulateKick(seed, f, gear));
      dist.sort((a, b) => b.distance - a.distance);
      // Higher accuracy picks closer to the best possible kick on that ball.
      const spread = (1 - boss.accuracy) * 0.7;
      const rank = Math.min(dist.length - 1, Math.floor(dist.length * spread * (0.3 + rng() * 1.4)));
      const r = dist[rank];
      const points = P.scoreKick(r, i, P.KICKS_PER_ROUND);
      total += points;
      kicks.push({ distance: r.distance, points, target: r.target, label: r.label });
    }
    return { kicks, total };
  }

  /** Wii-style skill change: big gains for beating stronger bosses, small losses. */
  function skillDelta(skill, boss, won) {
    const gap = boss.rating - skill;
    if (won) return Math.max(10, Math.min(140, Math.round(45 + gap * 0.15)));
    return -Math.max(0, Math.min(70, Math.round(20 - gap * 0.08)));
  }

  /**
   * Apply a finished match to a career. Returns what happened so the UI can
   * celebrate. Does not touch coins — the caller pays out `reward`.
   */
  function applyResult(careerIn, boss, playerScore, cpuTotal) {
    const career = normalize(careerIn);
    const won = playerScore > cpuTotal;
    const before = career.skill;
    const delta = skillDelta(before, boss, won);
    career.skill = Math.max(0, Math.min(MAX_SKILL, before + delta));
    career.matches += 1;
    if (won) career.wins += 1;
    const firstWin = won && !career.beaten.includes(boss.id);
    if (firstWin) career.beaten = career.beaten.concat(boss.id);
    career.history = career.history.concat(career.skill).slice(-HISTORY);
    const wentPro = !career.pro && career.skill >= PRO_SKILL;
    if (wentPro) career.pro = true;
    return {
      career,
      outcome: {
        boss: { id: boss.id, name: boss.name, avatar: boss.avatar },
        won, cpuTotal, playerScore, skillBefore: before, skillAfter: career.skill,
        firstWin, reward: firstWin ? boss.reward : 0, wentPro,
        nextBoss: firstWin ? (BOSSES[BOSSES.indexOf(boss) + 1] || null) : null,
      },
    };
  }

  return {
    PRO_SKILL, MAX_SKILL, TIERS, BOSSES,
    newCareer, normalize, bossById, isUnlocked, gearFor, cpuRound, skillDelta, applyResult,
  };
});
