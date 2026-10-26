/* Eggers Kick Off — game loop and kick state machine. */
(function () {
  'use strict';
  const P = window.EKPhysics;
  const EK = (window.EK = window.EK || {});
  const sfx = () => EK.sfx;

  const DT = P.DT;
  const REST = { frontLeg: 0.06, frontBend: 0.06, backLeg: -0.1, backBend: 0.06, frontArm: 0.25, backArm: -0.25, lean: 0, jump: 0 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (t) => t * t * (3 - 2 * t);

  function contactPose(h) {
    const reachStraight = HIP_Y_WORLD - Math.cos(2.5) * 0.92;
    let a;
    let jump = 0;
    if (h > reachStraight) {
      a = 2.5;
      jump = h - reachStraight;
    } else {
      a = Math.acos(clamp((HIP_Y_WORLD - h) / 0.92, -1, 1));
    }
    return { a, jump };
  }
  const HIP_Y_WORLD = 0.95;

  const HENRY_SCALE = 0.45; // Henry juggles at 45% of Jason's heights
  const HENRY_BLEND = 25;   // flight frames over which the ball eases up to its real path

  class Game {
    constructor(canvas, hud) {
      this.canvas = canvas;
      this.hud = hud;
      this.r = new EK.Renderer(canvas);
      this.mode = 'idle';
      this.time = 0;
      this.acc = 0;
      this.last = performance.now();
      this.camX = P.BALL_X;
      this.scale = this.r.juggleScale();
      this.anchor = 0.42;
      this.k = null;
      this.cfg = null;
      this.fast = false;
      this.inputDown = false;

      // Phones rotate, foldables fold/unfold, browser bars slide: keep the canvas matched.
      const onResize = () => {
        const wasJuggleScale = Math.abs(this.scale - this.r.juggleScale()) < 0.5;
        this.r.resize();
        if (wasJuggleScale || !this.k || this.k.phase === 'juggle') this.scale = this.r.juggleScale();
      };
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
      if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
      if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);
      this.perf = { ema: 16.7, slow: 0, fast: 0 };
      const press = (e) => {
        if (e.target && e.target.closest && e.target.closest('.ui, button, input, a')) return;
        this.input();
      };
      canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); press(e); });
      window.addEventListener('keydown', (e) => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        if (['Tab', 'Escape', 'Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
        if (this.mode !== 'play' && this.mode !== 'replay') return;
        e.preventDefault();
        this.input();
      });
      requestAnimationFrame((t) => this.frame(t));
    }

    // ---- Public API --------------------------------------------------------
    attract(equipped) {
      this.mode = 'attract';
      this.cfg = { upgrades: {}, equipped: equipped || {}, kicks: Infinity };
      this.r.setEquipped(this.cfg.equipped);
      this.setupKick(0, (Math.random() * 2 ** 32) >>> 0);
      this.snapCamera();
    }

    /**
     * cfg: { baseSeed, upgrades, equipped, kicks (number|Infinity), title,
     *        submit(index, frame, sim, localPoints) -> Promise<resolution>,
     *        onEnd(lastResolution, total), onAbort(message) , beat }
     */
    startRound(cfg) {
      this.mode = 'play';
      this.cfg = cfg;
      this.total = 0;
      this.best = 0;
      this.history = []; // { perfect, power } per kick: 5 PERFECTs in a row earn a Power Ball
      this.r.setEquipped(cfg.equipped);
      this.setupKick(0);
      this.snapCamera();
      this.hud.flash();
    }

    startReplay(cfg) {
      this.mode = 'replay';
      this.cfg = Object.assign({ kicks: 1 }, cfg);
      this.r.setEquipped(cfg.equipped);
      this.setupKick(0, cfg.seed);
      const j = this.k.juggler;
      const startAt = Math.max(0, cfg.frame - 100);
      while (j.frame < startAt) P.stepJuggler(j);
      this.k.autoKickAt = cfg.frame;
      this.snapCamera();
      this.hud.flash();
    }

    stop() {
      this.mode = 'idle';
      this.k = null;
    }

    get playing() {
      return this.mode === 'play';
    }

    // ---- Kick lifecycle ----------------------------------------------------
    setupKick(index, seedOverride) {
      const cfg = this.cfg;
      const seed = seedOverride != null ? seedOverride >>> 0 : P.kickSeed(cfg.baseSeed, index);
      const st = P.stats(cfg.upgrades);
      const k = {
        index,
        seed,
        st,
        wind: P.windFor(seed),
        golden: P.isGoldenBall(seed),
        power: this.mode === 'play' ? P.powerBallFor(seed, this.history) : this.mode === 'replay' ? (cfg.power || null) : null,
        powerSkin: null,
        objects: P.fieldObjects(seed, st.luck),
        juggler: P.createJuggler(seed, st),
        phase: 'juggle',
        lastBounces: 0,
        sim: null,
        swingT: 0,
        followT: 0,
        pathPos: 0,
        eventIdx: 0,
        rot: 0,
        resolution: null,
        resultT: 0,
        shown: false,
        contact: null,
      };
      // During Spooky Season the Piñata comes in random Halloween skins (just looks; the prize is the same).
      if (k.power === 'pinata') {
        const skins = window.EKCatalog.seasonActive('halloween') ? ['star', 'basket', 'brain'] : ['star'];
        k.powerSkin = skins[P.hashSeed(seed, 0x5C1) % skins.length];
      }
      this.k = k;
      this.fast = false;
      this.r.setField(k.objects);
      this.r.particles = [];
      if (this.mode === 'play') {
        const pw = k.power && P.POWER_BALLS[k.power];
        this.hud.hint(pw
          ? `${pw.icon} POWER BALL: ${pw.name}! ${pw.desc}${k.golden ? ` And it's golden: ×${window.EKCatalog.GOLDEN_MULT} coins!` : ''}`
          : k.golden
          ? `🌟 GOLDEN BALL — this kick pays ×${window.EKCatalog.GOLDEN_MULT} coins!`
          : 'Click, tap or press any key to kick — strike it in the green SWEET SPOT');
        this.hud.golden(k.golden);
        if (this.hud.power) this.hud.power(k.power, P.perfectRun(this.history));
        if (pw && sfx().levelUp) sfx().levelUp();
      }
    }

    snapCamera() {
      this.camX = P.BALL_X;
      this.scale = this.r.juggleScale();
      this.anchor = 0.42;
    }

    input() {
      sfx().unlock();
      const k = this.k;
      if (!k || this.inputBlocked) return;
      if (this.mode === 'replay') {
        if (k.phase === 'flight' || k.phase === 'result' || k.phase === 'landed') this.endReplay();
        return;
      }
      if (this.mode !== 'play') return;
      if (k.phase === 'juggle') this.kick();
      else if (k.phase === 'flight') this.fast = true;
      else if (k.phase === 'result' && k.resultT > 35) this.advance();
    }

    kick() {
      const k = this.k;
      const cfg = this.cfg;
      const kickFrame = k.juggler.frame;
      k.sim = P.simulateKick(k.seed, kickFrame, cfg.upgrades, { record: true, power: k.power });
      if (this.mode === 'play') this.history.push({ perfect: P.isPerfect(k.sim), power: k.power });
      k.kickFrame = kickFrame;
      k.contact = contactPose(k.sim.contactHeight);
      k.phase = 'swing';
      k.swingT = 0;
      this.hud.hint(null);
      if (this.mode !== 'play') return;
      const localPoints = P.scoreKick(k.sim, k.index, cfg.kicks);
      k.localPoints = localPoints;
      Promise.resolve()
        .then(() => cfg.submit(k.index, kickFrame, k.sim, localPoints))
        .then(
          (res) => { k.resolution = res || { points: localPoints }; },
          (err) => { k.resolution = { error: (err && err.message) || 'Connection problem' }; }
        );
    }

    contactMoment() {
      const k = this.k;
      k.phase = 'flight';
      k.pathPos = 0;
      k.followT = 0;
      if (k.sim.whiff) sfx().whiff();
      else {
        sfx().kick(k.sim.quality);
        this.r.burst('kick', P.BALL_X, k.sim.contactHeight, 8);
      }
    }

    advance() {
      const k = this.k;
      const cfg = this.cfg;
      this.hud.hideResult();
      const res = k.resolution || {};
      if (res.done || k.index + 1 >= cfg.kicks) {
        this.mode = 'ended';
        cfg.onEnd && cfg.onEnd(res, this.total);
        return;
      }
      this.hud.flash();
      this.setupKick(k.index + 1);
      this.snapCamera();
    }

    endReplay() {
      const cb = this.cfg && this.cfg.onEnd;
      this.mode = 'ended';
      this.hud.hideResult();
      if (cb) cb();
    }

    // ---- Simulation tick (fixed 60 Hz) --------------------------------------
    tick() {
      const k = this.k;
      if (!k) return;
      if (k.phase === 'juggle') {
        P.stepJuggler(k.juggler);
        if (k.juggler.bounces !== k.lastBounces) {
          k.lastBounces = k.juggler.bounces;
          if (this.mode !== 'attract') sfx().juggle();
        }
        k.rot += 0.05;
        if (this.mode === 'replay' && k.juggler.frame === k.autoKickAt) this.kick();
      } else if (k.phase === 'swing') {
        P.stepJuggler(k.juggler);
        k.swingT++;
        if (k.swingT >= P.SWING_FRAMES) this.contactMoment();
      } else if (k.phase === 'flight') {
        this.stepFlight();
      } else if (k.phase === 'landed') {
        k.followT++;
        if (this.mode === 'replay') {
          this.showResult({ points: null });
        } else if (k.resolution) {
          if (k.resolution.error) {
            k.phase = 'error';
            this.mode = 'ended';
            this.cfg.onAbort && this.cfg.onAbort(k.resolution.error);
            return;
          }
          this.showResult(k.resolution);
        }
      } else if (k.phase === 'result') {
        k.resultT++;
        k.followT++;
        if (this.mode === 'replay' && k.resultT > 150) this.endReplay();
        else if (this.mode === 'play' && k.resultT > 200) this.advance();
      }
    }

    stepFlight() {
      const k = this.k;
      const path = k.sim.path;
      const n = path.length / 2;
      k.followT++;
      // Real-time for the strike, then speed up so long kicks don't drag on.
      const speed = P.playbackSpeed(k.pathPos, n, this.fast);
      const prev = k.pathPos;
      k.pathPos = Math.min(n, k.pathPos + speed);
      const ev = k.sim.events;
      while (k.eventIdx < ev.length && ev[k.eventIdx].f <= k.pathPos) {
        const e = ev[k.eventIdx++];
        if (e.type === 'pad') { sfx().pad(); this.r.burst('boing', e.x, 0.2, 14); this.hud.toastSmall('BOING! Bounce pad'); }
        else if (e.type === 'puddle') { sfx().splash(); this.r.burst('splash', e.x, 0.1, 18); this.hud.toastSmall('Splash! Puddle'); }
        else if (e.type === 'crater') { sfx().kick(1); this.r.burst('crater', e.x, 0.1, 50); this.hud.toastSmall('☄️ IMPACT!'); }
        else if (e.type === 'pinata') { sfx().target(3); this.r.burst('confetti', e.x, 0.4, 70); this.r.burst('candy', e.x, 0.3, 40); this.hud.toastSmall(k.powerSkin === 'basket' ? '🎃 The pail tips over: CANDY!' : k.powerSkin === 'brain' ? '🧠 Uh oh, the zombies smell a snack!' : '🪅 CRACK! The piñata bursts open!'); }
        else if (e.type === 'split') { sfx().pad(); this.r.burst('kick', e.x, this.ballPos().y, 14); this.hud.toastSmall('✂️ SPLIT!'); }
        else if (e.type === 'magnet') { sfx().pad(); this.r.burst('magnet', e.x, 0.3, 30); this.hud.toastSmall('🧲 Magnet pull… BULLSEYE!'); }
        else if (e.v > 2) { sfx().bounce(e.v); this.r.burst('dust', e.x, 0.05, 6); }
      }
      const pos = this.ballPos();
      const prevX = this.ballPosAt(prev).x;
      k.rot += (pos.x - prevX) / 0.11 / Math.max(1, speed) * 0.25;
      if (k.pathPos >= n) {
        k.phase = 'landed';
        this.fast = false;
      }
    }

    showResult(res) {
      const k = this.k;
      const sim = k.sim;
      k.restAt = this.time; // landing animations (Jack-o'-Ball, Eye-Ball, critters…) count from here
      k.phase = 'result';
      k.resultT = 0;
      const points = res.points != null ? res.points : k.localPoints;
      const result = res.result || sim;
      const target = result.target || null;
      if (this.mode === 'play') {
        this.total = res.total != null ? res.total : this.total + (points || 0);
        if (result.distance > this.best) this.best = result.distance;
      }
      k.henryHappy = !!target && target.name === 'Duck Pond';
      if (k.henryHappy) setTimeout(() => sfx().quack(), 350);
      if (target) {
        sfx().target(target.mult);
        this.r.burst('confetti', result.distance, 1, 40);
      } else if (sim.quality >= 0.95) {
        this.r.burst('confetti', result.distance, 1, 16);
      }
      this.hud.showResult({
        distance: result.distance,
        label: sim.label,
        firstBounce: sim.firstBounce,
        points: this.mode === 'replay' ? null : points,
        target,
        final: this.mode === 'play' && this.cfg.kicks !== Infinity && k.index === this.cfg.kicks - 1,
        newBestKick: !!res.newBestKick,
        replay: this.mode === 'replay' ? this.cfg.title : null,
        extra: res.extra || null,
        earned: res.earned || null,
        milestones: res.milestones || null,
        challenges: res.challenges || null,
        index: k.index,
        henry: k.henryHappy,
        power: sim.power || null,
        magnetFrom: sim.magnetFrom,
        split: result.split || sim.split || null,
        pinata: res.pinata || null,
      });
      // Update the PERFECT streak only once the result is showing (no spoilers mid-flight).
      if (this.mode === 'play' && !k.power && this.hud.power) this.hud.power(null, P.perfectRun(this.history));
    }

    // ---- Ball position ----------------------------------------------------
    ballPosAt(pos) {
      const k = this.k;
      const path = k.sim.path;
      const n = path.length / 2;
      if (pos <= 0) return { x: P.BALL_X, y: k.sim.contactHeight };
      const i = Math.min(n, Math.floor(pos));
      const f = pos - i;
      const ax = i === 0 ? P.BALL_X : path[(i - 1) * 2];
      const ay = i === 0 ? k.sim.contactHeight : path[(i - 1) * 2 + 1];
      if (i >= n) return { x: ax, y: ay };
      const bx = path[i * 2], by = path[i * 2 + 1];
      return { x: lerp(ax, bx, f), y: lerp(ay, by, f) };
    }

    ballPos() {
      const k = this.k;
      if (k.phase === 'juggle' || k.phase === 'swing') {
        // Interpolate between fixed steps for silky juggling.
        const j = k.juggler;
        const t = this.acc / DT;
        const vy = j.vy - j.g * DT * t;
        const y = Math.max(P.JUGGLE_FLOOR, j.y + vy * DT * t);
        return { x: P.BALL_X, y };
      }
      return this.ballPosAt(k.pathPos);
    }

    // ---- Henry -------------------------------------------------------------
    // Henry is a look, not a different kicker: the juggle, timing and flight are Jason's exactly.
    // While he juggles, ball heights are drawn at duck scale; after the kick the ball eases back
    // up to its real path over the first few frames of flight.
    henryDrop(pathPos) {
      const k = this.k;
      const c = k && k.sim ? k.sim.contactHeight : 0;
      return c * (1 - HENRY_SCALE) * Math.max(0, 1 - pathPos / HENRY_BLEND);
    }

    henryBall(phys) {
      const k = this.k;
      if (k.phase === 'juggle' || k.phase === 'swing') return { x: phys.x, y: phys.y * HENRY_SCALE };
      return { x: phys.x, y: Math.max(0, phys.y - this.henryDrop(k.pathPos || 0)) };
    }

    henryPose(phys) {
      const k = this.k;
      const pose = { lift: 0, kick: 0, cheer: false, nameTag: this.mode !== 'play' || (k.index === 0 && k.phase === 'juggle') };
      if (k.phase === 'juggle' || (k.phase === 'swing' && k.swingT === 0)) {
        // A little hop as the ball drops to his feet
        const l = ease(clamp(1 - (phys.y - P.JUGGLE_FLOOR) / 0.6, 0, 1));
        pose.lift = 0.05 * l;
        pose.kick = 0.45 * l;
        return pose;
      }
      // Flying kick: jump up to meet the ball at its (duck-scale) contact height.
      const reach = Math.max(0, (k.sim ? k.sim.contactHeight : 1.4) * HENRY_SCALE - 0.32);
      if (k.phase === 'swing') {
        const p = clamp((k.swingT + this.acc / DT) / P.SWING_FRAMES, 0, 1);
        pose.lift = reach * ease(p);
        pose.kick = p;
        return pose;
      }
      const t = clamp(k.followT / 26, 0, 1);
      pose.lift = reach * (1 - t) * (1 - t);
      pose.kick = 1 - ease(t);
      if (k.phase === 'result' && k.sim && !k.sim.whiff && (k.sim.quality > 0.8 || k.sim.target)) pose.cheer = true;
      return pose;
    }

    // ---- Poses ------------------------------------------------------------
    jasonPose(ball) {
      const k = this.k;
      const pose = Object.assign({}, REST, { nameTag: this.mode !== 'play' || (k.index === 0 && k.phase === 'juggle') });
      if (k.phase === 'juggle' || (k.phase === 'swing' && k.swingT === 0)) {
        const lift = clamp(1 - (ball.y - P.JUGGLE_FLOOR) / 0.6, 0, 1);
        const l = ease(lift);
        pose.frontLeg = lerp(REST.frontLeg, 1.15, l);
        pose.frontBend = lerp(REST.frontBend, 1.5, l);
        pose.frontArm = 0.5 + 0.2 * l;
        pose.backArm = -0.5 - 0.2 * l;
        return pose;
      }
      const c = k.contact;
      if (k.phase === 'swing') {
        const p = clamp((k.swingT + this.acc / DT) / P.SWING_FRAMES, 0, 1);
        if (p < 0.35) {
          const t = ease(p / 0.35);
          pose.frontLeg = lerp(0.3, -0.7, t);
          pose.frontBend = lerp(0.6, 1.3, t);
        } else {
          const t = ease((p - 0.35) / 0.65);
          pose.frontLeg = lerp(-0.7, c.a, t);
          pose.frontBend = lerp(1.3, 0.1, t);
        }
        pose.jump = c.jump * ease(p);
        pose.lean = -Math.min(0.5, (c.a / 2.5) * 0.45) * ease(p);
        pose.frontArm = lerp(0.3, -0.9, p);
        pose.backArm = lerp(-0.3, 1.3, p);
        return pose;
      }
      // Follow-through, then watch the ball.
      const t = clamp(k.followT / 26, 0, 1);
      const a = c.a + 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.6));
      pose.frontLeg = lerp(a, REST.frontLeg, ease(t));
      pose.frontBend = lerp(0.1, REST.frontBend, ease(t));
      pose.jump = c.jump * (1 - t) * (1 - t);
      pose.lean = lerp(-Math.min(0.5, (c.a / 2.5) * 0.45), 0, ease(t));
      pose.frontArm = lerp(-0.9, 0.3, ease(t));
      pose.backArm = lerp(1.3, -0.3, ease(t));
      if (k.phase === 'result' && k.sim && !k.sim.whiff && (k.sim.quality > 0.8 || k.sim.target)) {
        const w = Math.sin(this.time * 10) * 0.15;
        pose.frontArm = 2.8 + w;
        pose.backArm = 2.6 - w;
        pose.cheer = true;
        pose.jump = Math.abs(Math.sin(this.time * 6)) * 0.12;
      }
      return pose;
    }

    // ---- Frame ------------------------------------------------------------
    /**
     * Adaptive quality: if frames keep taking too long (a slow phone), render at a
     * lower resolution; if there's plenty of headroom again, step back up.
     */
    trackPerformance(ms) {
      if (ms > 100 || document.hidden) return;
      const p = this.perf;
      p.ema = p.ema * 0.9 + ms * 0.1;
      if (p.ema > 24) { p.slow++; p.fast = 0; } else if (p.ema < 17.5) { p.fast++; p.slow = 0; } else { p.slow = 0; p.fast = 0; }
      if (p.slow > 45 && this.r.quality > 0.5) { this.r.setQuality(this.r.quality - 0.15); p.slow = 0; p.ema = 16.7; }
      if (p.fast > 600 && this.r.quality < 1) { this.r.setQuality(this.r.quality + 0.1); p.fast = 0; }
    }

    frame(ts) {
      const dt = Math.min(0.1, (ts - this.last) / 1000);
      this.trackPerformance(ts - this.last);
      this.last = ts;
      this.time += dt;
      if (this.covered) {
        // A full-screen sheet hides the field (phones): don't spend battery drawing it.
        requestAnimationFrame((t) => this.frame(t));
        return;
      }
      if (this.k && this.mode !== 'idle' && this.mode !== 'ended') {
        this.acc += dt;
        let guard = 0;
        while (this.acc >= DT && guard++ < 10) {
          this.tick();
          this.acc -= DT;
        }
        if (guard >= 10) this.acc = 0;
      }
      this.r.updateParticles(dt);
      if (this.k) this.render(dt);
      requestAnimationFrame((t) => this.frame(t));
    }

    render(dt) {
      const k = this.k;
      const r = this.r;
      const phys = this.ballPos();
      // Playing as Henry: the same physics, drawn at duck height (see henryBall).
      const henry = !!(this.cfg && this.cfg.equipped && this.cfg.equipped.character === 'henry');
      const ball = henry ? this.henryBall(phys) : phys;
      const inAir = k.phase === 'flight' || k.phase === 'landed' || k.phase === 'result' || k.phase === 'error';
      const js = r.juggleScale();
      let targetScale = js;
      let targetAnchor = this.mode === 'attract' && r.W >= 700 ? 0.3 : r.W < 600 ? 0.5 : 0.42;
      if (inAir) {
        // Pull out as the ball climbs; when it lands, keep enough field in view to see the targets.
        const maxAir = k.sim.whiff ? js : Math.min(js, Math.max(4, r.W / 230));
        targetScale = clamp((r.groundY - 110) / (ball.y + 3), 0.2, maxAir);
        const lookAhead = Math.min(1, (k.sim.launchSpeed || 0) / 60);
        targetAnchor = 0.42 - 0.12 * lookAhead;
      }
      const sk = 1 - Math.exp(-dt * (inAir ? 3.2 : 8));
      this.scale = Math.exp(lerp(Math.log(this.scale), Math.log(targetScale), sk));
      if (inAir && ball.y > 0.5) {
        // Never let a rising ball leave the top of the screen (or hide under the HUD).
        const topRoom = r.groundY - (r.W < 600 ? 150 : 130);
        if (ball.y * this.scale > topRoom) this.scale = Math.max(0.2, topRoom / ball.y);
      }
      this.anchor = lerp(this.anchor, targetAnchor, 1 - Math.exp(-dt * 2));
      this.camX = ball.x;

      let trail = null;
      if (inAir && k.sim && !k.sim.whiff) {
        const end = Math.floor(k.pathPos);
        const start = Math.max(0, end - 70);
        trail = k.sim.path.slice(start * 2, end * 2);
        if (henry && start < HENRY_BLEND) {
          for (let i = 0; i < trail.length; i += 2) trail[i + 1] -= this.henryDrop(start + i / 2);
        }
      }

      // Split Shot: the second ball after the split.
      let ball2 = null;
      let trail2 = null;
      if (inAir && k.sim && k.sim.splitPath && k.pathPos >= k.sim.splitFrame) {
        const sp = k.sim.splitPath;
        const n2 = sp.length / 2;
        const i = Math.min(n2, Math.floor(k.pathPos));
        ball2 = { x: sp[(i - 1) * 2], y: sp[(i - 1) * 2 + 1] };
        const s0 = Math.max(k.sim.splitFrame - 1, i - 70);
        trail2 = sp.slice(s0 * 2, i * 2);
      }
      // Landing animations: special balls do something once they come to rest.
      const eqBall = this.cfg && this.cfg.equipped ? this.cfg.equipped.ball : null;
      const atRest = k.phase === 'result' && k.restAt != null && k.sim && !k.sim.whiff;
      const restT = atRest ? this.time - k.restAt : null;
      if (atRest && !k.restBurst) {
        k.restBurst = true;
        this.r.restBurst(k.power ? `power:${k.power}:${k.powerSkin || ''}` : eqBall, ball.x);
      }
      const restTarget = atRest ? ((k.resolution && k.resolution.result && k.resolution.result.target) || k.sim.target) : null;
      // 🐍 Medusa Ball at the Duck Pond turns Henry into a concrete porch goose.
      const henryStone = !!(restTarget && restTarget.name === 'Duck Pond' && eqBall === 'medusa' && !k.power);

      r.draw({
        camX: this.camX,
        scale: this.scale,
        anchor: this.anchor,
        time: this.time,
        ball: { x: ball.x, y: ball.y, rot: k.rot, visible: true, rest: k.power ? null : restT },
        powerSkin: k.powerSkin || null,
        powerRest: k.power ? restT : null,
        henryStone,
        critter: restTarget && restT != null ? { x: ball.x, name: restTarget.name, t: restT } : null,
        ball2,
        trail2,
        jason: henry ? null : this.jasonPose(phys),
        henry: henry ? this.henryPose(phys) : null,
        yScale: henry ? HENRY_SCALE : 1,
        showSweet: (k.phase === 'juggle' || k.phase === 'swing') && this.mode !== 'attract',
        golden: k.golden && this.mode === 'play',
        power: k.power || null,
        henryHappy: k.phase === 'result' && !!k.henryHappy && !henryStone,
        henryBuddy: this.mode === 'attract' && !henry,
        sweetWidth: k.st.sweetWidth,
        trail,
      });

      if (this.mode === 'play' || this.mode === 'replay') {
        this.hud.update({
          mode: this.mode,
          phase: k.phase,
          index: k.index,
          kicks: this.cfg.kicks,
          total: this.total || 0,
          wind: k.wind,
          ballX: inAir ? ball.x : 0,
          ball2X: ball2 ? ball2.x : k.sim && k.sim.split && k.phase !== 'flight' && inAir ? k.sim.split.distance : null,
          height: inAir ? ball.y : 0,
          fast: this.fast,
        });
      }
    }
  }

  EK.Game = Game;
})();
