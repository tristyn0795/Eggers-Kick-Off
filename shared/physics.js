/*
 * Eggers Kick Off — deterministic kick simulation.
 *
 * Shared by the browser (for playback) and the server (for authoritative
 * scoring). The step loop only uses + - * / and Math.sqrt, which are exactly
 * specified by IEEE-754, so every JS engine produces the same result for the
 * same (seed, kickFrame, upgrades) input.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EKPhysics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DT = 1 / 60;
  const G = 9.8;
  const SWING_FRAMES = 6;            // frames between input and foot contact
  const MAX_WAIT_FRAMES = 60 * 60 * 10; // 10 minutes of juggling, max
  const JUGGLE_FLOOR = 0.8;          // knee height — the ball pops off Jason's knee
  const SWEET_SPOT = 1.6;            // chest / head height
  const BALL_X = 0.55;
  const BASE_SPEED = 95;
  const MAX_FLIGHT_FRAMES = 60 * 900;
  const KICKS_PER_ROUND = 10;
  // Bump whenever kick physics, scoring or targets change. Store-installed apps carry their own
  // copy of this file; an app with an older RULES_VERSION is asked to update before playing online.
  const RULES_VERSION = 1;
  const FIELD_LENGTH = 160000;

  // Topgolf-style targets on the field. Points are awarded for where the ball
  // comes to rest. The Click Wise Design Office sits at the classic 4,000 m.
  const TARGETS = [
    { x: 150, name: 'Coffee Cup', pts: 10, color: '#e53935' },
    { x: 400, name: 'Car Park', pts: 20, color: '#fb8c00' },
    { x: 550, name: 'Market Street', pts: 25, color: '#c62828', local: true },
    { x: 750, name: 'Duck Pond', pts: 35, color: '#fdd835' },
    { x: 1200, name: 'Water Tower', pts: 50, color: '#43a047' },
    { x: 1500, name: 'Celebration Park', pts: 60, color: '#7cb342', local: true },
    { x: 1800, name: 'Pizza Shack', pts: 75, color: '#00acc1' },
    { x: 2200, name: 'Watters Creek Bathrooms', pts: 90, color: '#5c6bc0', local: true },
    { x: 2600, name: 'Billboard', pts: 100, color: '#8e24aa' },
    { x: 2950, name: 'Allen Premium Outlets', pts: 125, color: '#ef6c00', local: true },
    { x: 3300, name: 'Gas Station', pts: 150, color: '#f4511e' },
    { x: 4000, name: 'Click Wise Design Office', pts: 250, color: '#047dc3', office: true },
    { x: 5200, name: 'Downtown', pts: 300, color: '#d81b60' },
    { x: 6500, name: 'Airport', pts: 400, color: '#546e7a' },
    { x: 8000, name: 'Mountain Peak', pts: 550, color: '#6d4c41' },
    { x: 9200, name: 'Ski Lodge', pts: 650, color: '#29b6f6' },
    { x: 10500, name: 'Satellite Dish', pts: 800, color: '#ffd600' },
    { x: 12000, name: 'Lighthouse', pts: 1000, color: '#c62828' },
    { x: 13500, name: 'Volcano', pts: 1250, color: '#ff6d00' },
    { x: 15000, name: 'Rocket Launch Pad', pts: 1600, color: '#5e35b1' },
    { x: 17000, name: 'Moon Base', pts: 2500, color: '#78909c' },
    { x: 19500, name: 'Desert Oasis', pts: 3000, color: '#f9a825' },
    { x: 22500, name: 'Pyramids', pts: 3600, color: '#c69c6d' },
    { x: 26000, name: 'Pirate Cove', pts: 4300, color: '#00897b' },
    { x: 30000, name: 'Castle', pts: 5200, color: '#7e57c2' },
    { x: 34000, name: 'Wind Farm', pts: 6200, color: '#26a69a' },
    { x: 38500, name: 'Glacier', pts: 7400, color: '#4fc3f7' },
    { x: 43000, name: 'Allen Eagle Stadium', pts: 9000, color: '#e53935', local: true },
    { x: 48000, name: 'Space Elevator', pts: 11000, color: '#3949ab' },
    { x: 54000, name: 'Mars Colony', pts: 13500, color: '#d84315' },
    { x: 60000, name: 'Black Hole', pts: 17000, color: '#4a148c' },
    { x: 68000, name: 'Eggers Galaxy HQ', pts: 25000, color: '#047dc3', jackpot: true },
  ];
  // Beyond the Galaxy HQ the field keeps going: a Frontier Beacon every 8 km, each worth more.
  for (let i = 1, x = 76000; x <= 152000; i++, x += 8000) {
    TARGETS.push({ x, name: `Frontier Beacon ${i}`, pts: 25000 + 3000 * i, color: '#00bfa5', beacon: true });
  }
  const RINGS = [
    { name: 'BULLSEYE', mult: 3 },
    { name: 'INNER RING', mult: 2 },
    { name: 'OUTER RING', mult: 1 },
  ];

  function ringRadii(t) {
    const inner = 6 + t.x * 0.006;
    return [inner, inner * 2.2, inner * 4];
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(a, b) {
    let h = (a ^ 0x9E3779B9) >>> 0;
    h = Math.imul(h ^ ((b + 0x7F4A7C15) | 0), 0x85EBCA6B);
    h ^= h >>> 13;
    h = Math.imul(h, 0xC2B2AE35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function kickSeed(baseSeed, index) {
    return hashSeed(baseSeed >>> 0, index | 0);
  }

  const MAX_UPGRADE_LEVEL = 50;

  function clampLevel(v) {
    v = v | 0;
    return v < 0 ? 0 : v > MAX_UPGRADE_LEVEL ? MAX_UPGRADE_LEVEL : v;
  }

  // Levels 1-5 give the full step `a`, 6-10 the smaller step `b`, and 11-50 the
  // small, steady step `c` — so every level still helps but nothing runs away.
  function tiered(level, a, b, c) {
    return (level < 5 ? level : 5) * a
      + (level > 5 ? (level < 10 ? level : 10) - 5 : 0) * b
      + (level > 10 ? level - 10 : 0) * (c || 0);
  }

  function stats(upgrades) {
    const u = upgrades || {};
    const lv = (k) => clampLevel(u[k]);
    // Each prestige adds a permanent 2% kick power on top of upgrades.
    const prestige = Math.max(0, Math.min(99, u.prestige | 0));
    return {
      power: (1 + tiered(lv('boots'), 0.06, 0.04, 0.012)) * (1 + 0.02 * prestige),
      sweetWidth: 0.3 * (1 + tiered(lv('training'), 0.15, 0.08, 0.008)),
      reach: 2.5,
      restitution: 0.55 + tiered(lv('ball'), 0.04, 0.01, 0.0015),
      friction: 0.82 + tiered(lv('ball'), 0.02, 0.004, 0.0006),
      roll: Math.max(0.8, 5 - tiered(lv('ball'), 0.5, 0.15, 0.02)),
      luck: lv('luck'),
      juggleG: 22 * (1 - tiered(lv('focus'), 0.07, 0.03, 0.004)),
      drag: 0.008 * (1 - tiered(lv('aero'), 0.12, 0.05, 0.002)),
    };
  }

  function windFor(seed) {
    const r = mulberry32(hashSeed(seed, 0x57A9D));
    return Math.round((-5 + r() * 13) * 10) / 10;
  }

  function fieldObjects(seed, luck) {
    const r = mulberry32(hashSeed(seed, 0xF1E1D));
    const out = [];
    const pPad = 0.22 + tiered(luck | 0, 0.04, 0.015, 0.003);
    const pPuddle = Math.max(0.003, 0.18 - tiered(luck | 0, 0.025, 0.008, 0.0003));
    let x = 120 + r() * 120;
    while (x < FIELD_LENGTH) {
      const roll = r();
      const variant = Math.floor(r() * 4);
      let type = 'decor';
      if (roll < pPad) type = 'pad';
      else if (roll < pPad + pPuddle) type = 'puddle';
      out.push({ x: x, type: type, w: type === 'pad' ? 28 : type === 'puddle' ? 36 : 0, v: variant });
      x += 110 + r() * 260;
    }
    return out;
  }

  function objectAt(objects, x) {
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (o.x - o.w > x) break;
      if (o.w && x >= o.x - o.w / 2 && x <= o.x + o.w / 2) return o;
    }
    return null;
  }

  // --- Juggling -----------------------------------------------------------
  function createJuggler(seed, st) {
    return {
      rng: mulberry32(hashSeed(seed, 0x1A661E)),
      g: st.juggleG,
      y: 2.6,
      vy: 0,
      apex: 2.6,
      frame: 0,
      bounces: 0,
    };
  }

  function stepJuggler(j) {
    j.vy -= j.g * DT;
    j.y += j.vy * DT;
    if (j.y <= JUGGLE_FLOOR && j.vy < 0) {
      j.y = JUGGLE_FLOOR;
      // Mostly hittable bounces with the odd dud that never reaches the sweet spot.
      j.apex = 1.15 + j.rng() * 1.95;
      j.vy = Math.sqrt(2 * j.g * (j.apex - JUGGLE_FLOOR));
      j.bounces++;
    }
    j.frame++;
  }

  // --- Scoring ------------------------------------------------------------
  function targetFor(x) {
    for (let i = 0; i < TARGETS.length; i++) {
      const t = TARGETS[i];
      const d = x > t.x ? x - t.x : t.x - x;
      const radii = ringRadii(t);
      for (let r = 0; r < radii.length; r++) {
        if (d <= radii[r]) {
          return {
            index: i,
            name: t.name,
            ring: RINGS[r].name,
            mult: RINGS[r].mult,
            points: t.pts * RINGS[r].mult,
            office: !!t.office,
          };
        }
      }
    }
    return null;
  }

  function timingLabel(q, whiff) {
    if (whiff) return 'WHIFF!';
    if (q >= 0.95) return 'PERFECT!';
    if (q >= 0.8) return 'GREAT!';
    if (q >= 0.55) return 'GOOD';
    if (q >= 0.3) return 'OK';
    return 'SHANKED';
  }

  /** Points for kick `index` of a round. Topgolf-style: last ball scores double. */
  function scoreKick(result, index, kicksPerRound) {
    const n = kicksPerRound || KICKS_PER_ROUND;
    let pts = Math.round(result.distance / 10) + (result.target ? result.target.points : 0);
    if (index === n - 1) pts *= 2;
    return pts;
  }

  /**
   * Simulate a whole kick. `kickFrame` is the juggle frame on which the player
   * pressed kick. With opts.record the full ball path is returned for playback.
   */
  function simulateKick(seed, kickFrame, upgrades, opts) {
    opts = opts || {};
    const record = !!opts.record;
    seed = seed >>> 0;
    kickFrame = kickFrame | 0;
    if (kickFrame < 0) kickFrame = 0;
    if (kickFrame > MAX_WAIT_FRAMES) kickFrame = MAX_WAIT_FRAMES;

    const st = stats(upgrades);
    const wind = windFor(seed);
    const objects = fieldObjects(seed, st.luck);

    const j = createJuggler(seed, st);
    const contactFrame = kickFrame + SWING_FRAMES;
    while (j.frame < contactFrame) stepJuggler(j);
    const h = j.y;
    const hvy = j.vy;

    const result = {
      seed: seed,
      kickFrame: kickFrame,
      contactHeight: h,
      wind: wind,
      whiff: false,
      quality: 0,
      label: '',
      launchSpeed: 0,
      launchAngle: 0,
      firstBounce: 0,
      maxHeight: 0,
      distance: 0,
      bounces: 0,
      padsHit: 0,
      puddlesHit: 0,
      target: null,
      flightFrames: 0,
      path: null,
      events: null,
    };

    const path = record ? [] : null;
    const events = record ? [] : null;

    let x = BALL_X, y = h, vx, vy;

    if (h > st.reach) {
      // Too high — the leg swings under it and the ball drops behind.
      result.whiff = true;
      vx = -0.6;
      vy = hvy;
    } else {
      const d = (h - SWEET_SPOT) / st.sweetWidth;
      const f = 1 + d * d;
      const q = 1 / (f * f);
      result.quality = q;
      const slope = 0.2 + 0.55 * h;
      let speed = BASE_SPEED * (0.3 + 0.7 * q) * st.power;
      if (hvy < 0) speed *= 1.03; // striking it on the drop adds a little zip
      const n = Math.sqrt(1 + slope * slope);
      vx = speed / n;
      vy = (speed * slope) / n;
      result.launchSpeed = speed;
      result.launchAngle = Math.round((Math.atan(slope) * 180) / Math.PI);
    }
    result.label = timingLabel(result.quality, result.whiff);

    let rolling = false;
    let frames = 0;
    let firstBounce = 0;
    let maxH = y;

    while (frames < MAX_FLIGHT_FRAMES) {
      frames++;
      if (!rolling) {
        vx += -st.drag * (vx - wind) * DT;
        vy += (-G - st.drag * vy) * DT;
        if (!result.whiff && vx < 0) vx = 0;
        x += vx * DT;
        y += vy * DT;
        if (y > maxH) maxH = y;
        if (y <= 0 && vy < 0) {
          y = 0;
          if (!firstBounce) firstBounce = x;
          const o = result.whiff ? null : objectAt(objects, x);
          if (o && o.type === 'pad') {
            vy = -vy * 1.05;
            if (vy < 30) vy = 30;
            vx *= 1.1;
            result.padsHit++;
            if (events) events.push({ f: frames, type: 'pad', x: x });
          } else if (o && o.type === 'puddle') {
            vx *= 0.3;
            vy = -vy * 0.2;
            result.puddlesHit++;
            if (events) events.push({ f: frames, type: 'puddle', x: x });
          } else {
            vy = -vy * st.restitution;
            vx *= st.friction;
            if (events) events.push({ f: frames, type: 'bounce', x: x, v: vy });
          }
          result.bounces++;
          if (vy < 3) {
            vy = 0;
            rolling = true;
          }
        }
      } else {
        const o = result.whiff ? null : objectAt(objects, x);
        if (o && o.type === 'pad' && vx > 0.5) {
          vy = 18;
          vx *= 1.1;
          rolling = false;
          result.padsHit++;
          if (events) events.push({ f: frames, type: 'pad', x: x });
        } else {
          let decel = st.roll;
          if (o && o.type === 'puddle') decel += 40;
          if (vx > 0) {
            vx -= decel * DT;
            if (vx < 0) vx = 0;
          } else {
            vx += decel * DT;
            if (vx > 0) vx = 0;
          }
          x += vx * DT;
        }
        if (vx < 0.05 && vx > -0.05 && rolling) {
          if (path) path.push(x, y);
          break;
        }
      }
      if (path) path.push(x, y);
    }

    const distance = x > 0 ? Math.floor(x * 10) / 10 : 0;
    result.distance = result.whiff ? 0 : distance;
    result.firstBounce = result.whiff ? 0 : Math.floor(firstBounce);
    result.maxHeight = Math.floor(maxH);
    result.flightFrames = frames;
    result.target = result.whiff ? null : targetFor(distance);
    if (record) {
      result.path = path;
      result.events = events;
    }
    return result;
  }

  /** Roughly 1 ball in 8 is a Golden Ball (worth extra coins). Fixed by the ball's seed, so everyone agrees. */
  function isGoldenBall(seed) {
    return hashSeed(seed >>> 0, 0x601D) % 8 === 0;
  }

  /**
   * How many path frames to advance per 60 Hz tick when replaying a kick. Long kicks
   * speed up so even a 40 km boot plays out in roughly ten seconds.
   */
  function playbackSpeed(pathPos, totalFrames, fast) {
    if (fast) return Math.max(9, totalFrames / (60 * 2.5));
    if (pathPos < 25) return 1;
    if (pathPos < 70) return 2;
    return Math.max(3.2, totalFrames / (60 * 9));
  }

  /** Ticks (at 60 Hz) a kick takes to play back without fast-forward, swing included. */
  function playbackTicks(totalFrames) {
    return SWING_FRAMES + Math.min(25, totalFrames) + Math.min(45, Math.max(0, totalFrames - 25)) / 2
      + Math.max(0, totalFrames - 70) / Math.max(3.2, totalFrames / (60 * 9));
  }

  return {
    DT, G, playbackSpeed, playbackTicks, isGoldenBall, SWING_FRAMES, MAX_WAIT_FRAMES, JUGGLE_FLOOR, SWEET_SPOT, BALL_X,
    KICKS_PER_ROUND, TARGETS, RINGS, MAX_UPGRADE_LEVEL, FIELD_LENGTH,
    mulberry32, hashSeed, kickSeed, stats, windFor, fieldObjects,
    createJuggler, stepJuggler, ringRadii, targetFor, scoreKick, simulateKick,
    timingLabel,
  };
});
