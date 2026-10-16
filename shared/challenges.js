/*
 * Eggers Kick Off — daily & weekly challenges.
 *
 * Everyone gets the same challenge *types* each day/week (picked from the date),
 * but the numbers are personal — scaled to the player's own bests when the period
 * starts — so they're fair at every stage. Progress is driven by verified kick and
 * round events; rewards are paid the moment a challenge completes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics'), require('./catalog'));
  else root.EKChallenges = factory(root.EKPhysics, root.EKCatalog);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P, C) {
  'use strict';

  const DAILY_COUNT = 3;
  const WEEKLY_COUNT = 3;
  const WEEKLY_MULT = 5;
  // Bump when challenge rules change: everyone's current challenges are re-rolled once.
  const VERSION = 2;

  const round50 = (n) => Math.max(50, Math.round(n / 50) * 50);
  const round100 = (n) => Math.max(100, Math.round(n / 100) * 100);

  // Each template builds a challenge for a profile. `weekly` asks for more.
  const TEMPLATES = [
    { id: 'perfects', icon: '🎯', make: (p, w) => ({ goal: w ? 20 : 3, text: (g) => `Land ${g} PERFECT kicks` }) },
    { id: 'targets', icon: '🏁', make: (p, w) => ({ goal: w ? 15 : 3, text: (g) => `Stop the ball inside a target ${g} times` }) },
    { id: 'bullseye', icon: '🎯', make: (p, w) => ({ goal: w ? 5 : 1, text: (g) => (g === 1 ? 'Hit a bullseye' : `Hit ${g} bullseyes`) }) },
    { id: 'rounds', icon: '⚽', make: (p, w) => ({ goal: w ? 10 : 2, text: (g) => `Finish ${g} rounds` }) },
    { id: 'pads', icon: '🦘', make: (p, w) => ({ goal: w ? 30 : 5, text: (g) => `Bounce off ${g} bounce pads` }) },
    {
      id: 'longkick', icon: '🚀', make: (p, w) => {
        const goal = round50(Math.max(300, (p.bestKick || 0) * (w ? 0.95 : 0.7)));
        return { goal, single: true, text: (g) => `Kick at least ${g.toLocaleString()} m in one kick` };
      },
    },
    {
      id: 'roundscore', icon: '💯', make: (p, w) => {
        const goal = round100(Math.max(800, (p.bestRound || 0) * (w ? 0.9 : 0.6)));
        return { goal, single: true, text: (g) => `Score ${g.toLocaleString()} points in one round` };
      },
    },
    {
      id: 'distance', icon: '🛣️', weeklyOnly: true, make: (p) => {
        const goal = round100(Math.max(5000, (p.bestKick || 0) * 15));
        return { goal, text: (g) => `Kick a total of ${g.toLocaleString()} m` };
      },
    },
    {
      id: 'career', icon: '🏆', make: (p, w) => ({ goal: w ? 3 : 1, text: (g) => (g === 1 ? 'Win a Career match' : `Win ${g} Career matches`) }),
    },
    {
      id: 'spot', icon: '📍', dailyOnly: true, make: (p, w, rng) => {
        // A named spot where this player's kicks usually land: not one they've long since kicked
        // past, and not one they can't reach yet. (Allen nods included!)
        const best = Math.max(800, p.bestKick || 0);
        let spots = P.TARGETS.filter((t) => !t.beacon && t.x >= best * 0.35 && t.x <= best * 0.85);
        if (!spots.length) {
          // Nothing in the sweet band: take the furthest target that's still within reach.
          const reachable = P.TARGETS.filter((t) => !t.beacon && t.x <= best * 0.9);
          spots = reachable.slice(-1);
        }
        const t = spots[Math.floor(rng() * spots.length)] || P.TARGETS[0];
        return { goal: 1, target: t.name, text: () => `Stop the ball at ${t.local ? '' : 'the '}${t.name}` };
      },
    },
  ];

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** UTC day key and ISO-week key for a timestamp. */
  function periodKeys(now) {
    const d = new Date(now == null ? Date.now() : now);
    const day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return { day, week: `${t.getUTCFullYear()}-W${pad2(week)}` };
  }

  /** When the current day and week end (ms timestamps). */
  function periodEnds(now) {
    const d = new Date(now == null ? Date.now() : now);
    const dayEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const dow = d.getUTCDay() || 7;
    const weekEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - dow));
    return { dayEnd, weekEnd };
  }

  function seedFor(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function rewardFor(profile, weekly) {
    const level = C.levelFromXp(profile.xp || 0);
    const base = 150 + 15 * level;
    return Math.round((weekly ? base * WEEKLY_MULT : base) / 10) * 10;
  }

  function build(profile, key, weekly) {
    const rng = P.mulberry32(seedFor(key));
    const pool = TEMPLATES.filter((t) => (weekly ? !t.dailyOnly : !t.weeklyOnly));
    const picked = [];
    while (picked.length < (weekly ? WEEKLY_COUNT : DAILY_COUNT) && pool.length) {
      picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    return picked.map((t) => {
      const c = t.make(profile, weekly, rng);
      return {
        id: t.id, icon: t.icon, goal: c.goal, single: !!c.single, target: c.target || null,
        text: c.text(c.goal), progress: 0, done: false, reward: rewardFor(profile, weekly),
      };
    });
  }

  /** Make sure the profile has this day's and week's challenges. Returns true if anything changed. */
  function roll(profile, now) {
    const { day, week } = periodKeys(now);
    let ch = profile.challenges || {};
    let changed = false;
    if (ch.v !== VERSION) {
      ch = { v: VERSION };
      changed = true;
    }
    if (ch.day !== day) {
      ch.day = day;
      ch.daily = build(profile, `d:${day}`, false);
      ch.dailyBonus = false;
      changed = true;
    }
    if (ch.week !== week) {
      ch.week = week;
      ch.weekly = build(profile, `w:${week}`, true);
      changed = true;
    }
    profile.challenges = ch;
    return changed;
  }

  function advance(c, ev) {
    if (c.done) return false;
    const before = c.progress;
    const k = ev.kick;
    switch (c.id) {
      case 'perfects': if (k && k.label === 'PERFECT!') c.progress += 1; break;
      case 'targets': if (k && k.target) c.progress += 1; break;
      case 'bullseye': if (k && k.target && k.target.ring === 'BULLSEYE') c.progress += 1; break;
      case 'pads': if (k) c.progress += k.padsHit || 0; break;
      case 'longkick': if (k) c.progress = Math.max(c.progress, Math.floor(k.distance)); break;
      case 'distance': if (k) c.progress += Math.floor(k.distance); break;
      case 'spot': if (k && k.target && k.target.name === c.target) c.progress = 1; break;
      case 'rounds': if (ev.round) c.progress += 1; break;
      case 'roundscore': if (ev.round) c.progress = Math.max(c.progress, ev.round.score); break;
      case 'career': if (ev.round && ev.round.careerWon) c.progress += 1; break;
    }
    if (c.progress >= c.goal) { c.progress = c.goal; c.done = true; }
    return c.progress !== before;
  }

  /**
   * Feed a verified event to the challenges: `{ kick: result }` after a kick, or
   * `{ round: { score, careerWon } }` when a round finishes. Pays out completed
   * challenges and returns them so the game can celebrate.
   */
  function progress(profile, ev, now) {
    roll(profile, now);
    const ch = profile.challenges;
    const completed = [];
    for (const [list, weekly] of [[ch.daily, false], [ch.weekly, true]]) {
      for (const c of list) {
        const wasDone = c.done;
        advance(c, ev);
        if (c.done && !wasDone) {
          profile.coins += c.reward;
          completed.push({ text: c.text, reward: c.reward, weekly });
        }
      }
    }
    if (!ch.dailyBonus && ch.daily.every((c) => c.done)) {
      ch.dailyBonus = true;
      const bonus = rewardFor(profile, false) * 2;
      profile.coins += bonus;
      completed.push({ text: 'All 3 daily challenges complete!', reward: bonus, weekly: false, bonus: true });
    }
    return completed;
  }

  return { DAILY_COUNT, WEEKLY_COUNT, TEMPLATES, periodKeys, periodEnds, roll, progress, rewardFor };
});
