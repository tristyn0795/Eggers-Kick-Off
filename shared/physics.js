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
  const MAX_FLIGHT_FRAMES = 60 * 240;
  const KICKS_PER_ROUND = 10;
  const FIELD_LENGTH = 40000;

  // Topgolf-style targets on the field. Points are awarded for where the ball
  // comes to rest. The Click Wise Design Office sits at the classic 4,000 m.
  const TARGETS = [
    { x: 150, name: 'Coffee Cup', pts: 10, color: '#e53935' },
    { x: 400, name: 'Car Park', pts: 20, color: '#fb8c00' },
    { x: 750, name: 'Duck Pond', pts: 35, color: '#fdd835' },
    { x: 1200, name: 'Water Tower', pts: 50, color: '#43a047' },
    { x: 1800, name: 'Pizza Shack', pts: 75, color: '#00acc1' },
    { x: 2600, name: 'Billboard', pts: 100, color: '#8e24aa' },
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
    { x: 17000, name: 'Moon Base', pts: 2500, color: '#78909c', jackpot: true },
  ];
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

  const MAX_UPGRADE_LEVEL = 10;

  function clampLevel(v) {
    v = v | 0;
    return v < 0 ? 0 : v > MAX_UPGRADE_LEVEL ? MAX_UPGRADE_LEVEL : v;
  }

  // Levels 1-5 give the full step `a`; levels 6-10 give the smaller step `b`.
  function tiered(level, a, b) {
    return (level < 5 ? level : 5) * a + (level > 5 ? level - 5 : 0) * b;
  }

  function stats(upgrades) {
    const u = upgrades || {};
    const lv = (k) => clampLevel(u[k]);
    return {
      power: 1 + tiered(lv('boots'), 0.06, 0.04),
      sweetWidth: 0.3 * (1 + tiered(lv('training'), 0.15, 0.08)),
      reach: 2.5,
      restitution: 0.55 + tiered(lv('ball'), 0.04, 0.01),
      friction: 0.82 + tiered(lv('ball'), 0.02, 0.004),
      roll: 5 - tiered(lv('ball'), 0.5, 0.15),
      luck: lv('luck'),
      juggleG: 22 * (1 - tiered(lv('focus'), 0.07, 0.03)),
      drag: 0.008 * (1 - tiered(lv('aero'), 0.12, 0.05)),
    };
  }

  function windFor(seed) {
    const r = mulberry32(hashSeed(seed, 0x57A9D));
    return Math.round((-5 + r() * 13) * 10) / 10;
  }

  function fieldObjects(seed, luck) {
    const r = mulberry32(hashSeed(seed, 0xF1E1D));
    const out = [];
    const pPad = 0.22 + tiered(luck | 0, 0.04, 0.015);
    const pPuddle = 0.18 - tiered(luck | 0, 0.025, 0.008);
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

  return {
    DT, G, SWING_FRAMES, MAX_WAIT_FRAMES, JUGGLE_FLOOR, SWEET_SPOT, BALL_X,
    KICKS_PER_ROUND, TARGETS, RINGS, MAX_UPGRADE_LEVEL, FIELD_LENGTH,
    mulberry32, hashSeed, kickSeed, stats, windFor, fieldObjects,
    createJuggler, stepJuggler, ringRadii, targetFor, scoreKick, simulateKick,
    timingLabel,
  };
});
