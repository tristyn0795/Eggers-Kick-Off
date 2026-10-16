/* Eggers Kick Off — canvas renderer. World units are metres; +y is up. */
(function () {
  'use strict';
  const P = window.EKPhysics;
  const C = window.EKCatalog;
  const EK = (window.EK = window.EK || {});

  const SKIN = '#8a5a3c';
  const SKIN_DARK = '#6b4129';
  const HAIR = '#ecebe6';
  const BEARD = '#cfcbc4';
  const BRAND = '#047dc3';
  const BRAND_GREEN = '#4caf50';

  const HIP_Y = 0.95;
  const THIGH = 0.45;
  const SHIN = 0.47;

  const NICE = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500];
  function niceStep(minMetres) {
    for (const n of NICE) if (n >= minMetres) return n;
    return 5000;
  }

  function seeded(n) {
    const r = P.mulberry32(n);
    return r;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.W = 0;
      this.H = 0;
      this.dpr = 1;
      this.objects = [];
      this.particles = [];
      this.equipped = Object.assign({}, C.DEFAULT_EQUIPPED);
      const r = seeded(77);
      this.clouds = Array.from({ length: 14 }, () => ({ x: r() * 3200, y: 0.05 + r() * 0.3, s: 0.6 + r() * 0.9 }));
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.canvas.clientWidth || window.innerWidth;
      const h = this.canvas.clientHeight || window.innerHeight;
      this.dpr = dpr;
      this.W = w;
      this.H = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.groundY = Math.round(h * 0.8);
    }

    /** Pixels per metre that frames Jason and his juggle nicely. */
    juggleScale() {
      return Math.min(170, Math.max(60, (this.groundY - 50) / 3.5), this.W / 4.2);
    }

    setField(objects) {
      this.objects = objects || [];
    }

    setEquipped(eq) {
      this.equipped = Object.assign({}, C.DEFAULT_EQUIPPED, eq);
    }

    // ---- Particles -------------------------------------------------------
    burst(type, x, y, n) {
      const colors = {
        dust: ['#c8b07a', '#a98f5a', '#e3d3a8'],
        splash: ['#4fc3f7', '#81d4fa', '#ffffff'],
        boing: ['#047dc3', '#4caf50', '#ffffff'],
        confetti: ['#047dc3', '#4caf50', '#ffd600', '#e53935', '#ffffff', '#ab47bc'],
        kick: ['#ffffff', '#fff59d'],
      }[type] || ['#fff'];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI;
        const sp = (type === 'confetti' ? 6 : 3) * (0.4 + Math.random());
        this.particles.push({
          type, x, y,
          vx: Math.cos(a) * sp * (type === 'confetti' ? 1.4 : 1),
          vy: Math.sin(a) * sp * (type === 'splash' ? 1.6 : 1),
          life: 1, decay: 0.012 + Math.random() * 0.02,
          color: colors[(Math.random() * colors.length) | 0],
          size: type === 'confetti' ? 0.25 : 0.12 + Math.random() * 0.15,
          screen: false,
        });
      }
    }

    updateParticles(dt) {
      for (const p of this.particles) {
        p.vy -= 9.8 * dt * (p.type === 'confetti' ? 0.3 : 0.8);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y < 0) { p.y = 0; p.vy *= -0.3; p.vx *= 0.7; }
        p.life -= p.decay;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
    }

    // ---- Coordinate helpers ---------------------------------------------
    sx(x) { return (x - this.camX) * this.scale + this.W * this.anchor; }
    sy(y) { return this.groundY - y * this.scale; }

    // ---- Frame -----------------------------------------------------------
    draw(st) {
      const ctx = this.ctx;
      this.camX = st.camX;
      this.scale = st.scale;
      this.time = st.time || 0;
      this.henryHappy = !!st.henryHappy;
      this.anchor = st.anchor == null ? 0.3 : st.anchor;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this.drawSky(st);
      this.drawHills();
      this.drawGround();
      this.drawLandmarks();
      this.drawTargets();
      this.drawObjects();
      this.drawMarkers();
      if (st.henryBuddy && this.visible(-1.6, 200)) this.drawHenry(this.sx(-1.3), this.groundY, Math.max(0.75 * this.scale, 20), { happy: false });
      if (st.jason) this.drawJason(st.jason);
      if (st.showSweet && st.jason) this.drawSweetSpot(st);
      if (st.trail) this.drawTrail(st.trail, st.time);
      if (st.ball && st.ball.visible) this.drawBall(st.ball.x, st.ball.y, st.ball.rot, st.time);
      this.drawParticles();
    }

    drawSky(st) {
      const { ctx, W, groundY } = this;
      const g = ctx.createLinearGradient(0, 0, 0, groundY);
      g.addColorStop(0, '#4fb3f6');
      g.addColorStop(1, '#d4f0ff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, groundY + 2);

      // Sun
      ctx.fillStyle = 'rgba(255, 244, 179, 0.9)';
      ctx.beginPath();
      ctx.arc(W * 0.82, groundY * 0.18, 38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 244, 179, 0.25)';
      ctx.beginPath();
      ctx.arc(W * 0.82, groundY * 0.18, 60, 0, Math.PI * 2);
      ctx.fill();

      // Clouds
      const drift = (st.time || 0) * 6;
      for (const c of this.clouds) {
        const span = 3200;
        let x = (c.x - this.camX * 0.25 - drift) % span;
        if (x < 0) x += span;
        x -= 200;
        if (x > W + 200) continue;
        this.cloud(x, c.y * groundY, c.s);
      }
    }

    cloud(x, y, s) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
      ctx.arc(x + 26 * s, y - 10 * s, 28 * s, 0, Math.PI * 2);
      ctx.arc(x + 56 * s, y, 22 * s, 0, Math.PI * 2);
      ctx.arc(x + 28 * s, y + 6 * s, 22 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    drawHills() {
      const { ctx, W, groundY } = this;
      const layers = [
        { k: 0.35, color: '#9fd3a8', base: 70, a: 28, f1: 0.004, f2: 0.011 },
        { k: 0.9, color: '#7cc487', base: 34, a: 18, f1: 0.007, f2: 0.017 },
      ];
      for (const L of layers) {
        const off = this.camX * L.k;
        ctx.fillStyle = L.color;
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        for (let x = 0; x <= W + 8; x += 8) {
          const u = x + off;
          const h = L.base + L.a * Math.sin(u * L.f1) + L.a * 0.6 * Math.sin(u * L.f2 + 1.3);
          ctx.lineTo(x, groundY - h);
        }
        ctx.lineTo(W, groundY);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawGround() {
      const { ctx, W, H, groundY, scale } = this;
      ctx.fillStyle = '#58b05c';
      ctx.fillRect(0, groundY, W, H - groundY);
      const step = niceStep(140 / scale);
      const left = this.camX - (this.W * this.anchor) / scale;
      const right = left + W / scale;
      ctx.fillStyle = '#62bd66';
      for (let k = Math.floor(left / step); k * step < right; k++) {
        if (k % 2 !== 0) continue;
        const x0 = this.sx(k * step);
        ctx.fillRect(x0, groundY, step * scale, H - groundY);
      }
      // Horizon edge
      ctx.fillStyle = '#4a9d4f';
      ctx.fillRect(0, groundY, W, 3);
    }

    visible(x, marginPx) {
      const s = this.sx(x);
      return s > -marginPx && s < this.W + marginPx;
    }

    drawMarkers() {
      const { ctx, groundY, scale } = this;
      const step = niceStep(110 / scale);
      const left = this.camX - (this.W * this.anchor) / scale;
      const right = left + this.W / scale;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (let k = Math.max(0, Math.floor(left / step)); k * step <= right; k++) {
        const m = k * step;
        const x = this.sx(m);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(x - 1, groundY, 2, 10);
        if (m === 0) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(`${m.toLocaleString()} m`, x, groundY + 26);
      }
    }

    drawTargets() {
      const { ctx, groundY, scale } = this;
      for (const t of P.TARGETS) {
        const radii = P.ringRadii(t);
        if (!this.visible(t.x, radii[2] * scale + 160)) continue;
        const cx = this.sx(t.x);
        const ringColors = [t.color, this.tint(t.color, 0.45), this.tint(t.color, 0.75)];
        for (let i = 2; i >= 0; i--) {
          const rx = Math.max(radii[i] * scale, 4 + i * 4);
          const ry = Math.max(2, Math.min(rx * 0.16, 20 - (2 - i) * 4));
          ctx.fillStyle = i === 0 ? t.color : ringColors[i];
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.ellipse(cx, groundY + ry + 1, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        // Sign
        const signY = groundY - 70;
        ctx.fillStyle = '#555';
        ctx.fillRect(cx - 1.5, signY, 3, 70);
        const label = `${t.name}`;
        const sub = `${t.pts} pts · ×3 bullseye`;
        ctx.font = 'bold 13px system-ui, sans-serif';
        const w = Math.max(ctx.measureText(label).width, 110) + 16;
        this.roundRect(cx - w / 2, signY - 38, w, 38, 7);
        ctx.fillStyle = t.color;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, signY - 21);
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(sub, cx, signY - 7);
      }
    }

    tint(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      const m = (c) => Math.round(c + (255 - c) * amt);
      return `rgb(${m(r)},${m(g)},${m(b)})`;
    }

    roundRect(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // Landmarks keep a minimum on-screen size so they read from far away.
    lmScale(min) {
      return Math.max(this.scale, min);
    }

    drawLandmarks() {
      for (const t of P.TARGETS) {
        // Landmarks sit up to ~250 landmark-units right of their target, so widen the cull margin.
        if (!this.visible(t.x, 900 + 250 * Math.max(this.scale, 2))) continue;
        const cx = this.sx(t.x);
        const gy = this.groundY;
        switch (t.name) {
          case 'Coffee Cup': this.lmCoffee(cx, gy); break;
          case 'Car Park': this.lmCars(cx, gy); break;
          case 'Market Street': this.lmMarketStreet(cx, gy); break;
          case 'Celebration Park': this.lmCelebrationPark(cx, gy); break;
          case 'Watters Creek Bathrooms': this.lmWattersCreek(cx, gy); break;
          case 'Allen Premium Outlets': this.lmOutlets(cx, gy); break;
          case 'Duck Pond': this.lmPond(cx, gy); break;
          case 'Water Tower': this.lmTower(cx, gy); break;
          case 'Pizza Shack': this.lmPizza(cx, gy); break;
          case 'Billboard': this.lmBillboard(cx, gy); break;
          case 'Click Wise Design Office': this.lmOffice(cx, gy); break;
          case 'Downtown': this.lmDowntown(cx, gy); break;
          case 'Airport': this.lmAirport(cx, gy); break;
          case 'Mountain Peak': this.lmMountain(cx, gy); break;
          case 'Satellite Dish': this.lmDish(cx, gy); break;
          case 'Gas Station': this.lmGas(cx, gy); break;
          case 'Ski Lodge': this.lmSki(cx, gy); break;
          case 'Lighthouse': this.lmLighthouse(cx, gy); break;
          case 'Volcano': this.lmVolcano(cx, gy); break;
          case 'Rocket Launch Pad': this.lmRocket(cx, gy); break;
          case 'Moon Base': this.lmMoonBase(cx, gy); break;
          case 'Desert Oasis': this.lmOasis(cx, gy); break;
          case 'Pyramids': this.lmPyramids(cx, gy); break;
          case 'Pirate Cove': this.lmPirate(cx, gy); break;
          case 'Castle': this.lmCastle(cx, gy); break;
          case 'Wind Farm': this.lmWindFarm(cx, gy); break;
          case 'Glacier': this.lmGlacier(cx, gy); break;
          case 'Allen Eagle Stadium': this.lmStadium(cx, gy); break;
          case 'Space Elevator': this.lmElevator(cx, gy); break;
          case 'Mars Colony': this.lmMars(cx, gy); break;
          case 'Black Hole': this.lmBlackHole(cx, gy); break;
          case 'Eggers Galaxy HQ': this.lmGalaxyHQ(cx, gy); break;
          default: if (t.beacon) this.lmBeacon(cx, gy);
        }
      }
    }

    lmCoffee(cx, gy) {
      const s = this.lmScale(6), ctx = this.ctx;
      const x = cx + 14 * s;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x - 3 * s, gy - 7 * s);
      ctx.lineTo(x + 3 * s, gy - 7 * s);
      ctx.lineTo(x + 2.3 * s, gy);
      ctx.lineTo(x - 2.3 * s, gy);
      ctx.fill();
      ctx.fillStyle = BRAND;
      ctx.fillRect(x - 2.8 * s, gy - 4.6 * s, 5.4 * s, 1.6 * s);
      ctx.fillStyle = '#6d4c41';
      ctx.fillRect(x - 3.2 * s, gy - 7.8 * s, 6.4 * s, 0.9 * s);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(1, 0.3 * s);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * s, gy - 8.4 * s);
        ctx.quadraticCurveTo(x + i * s + s, gy - 9.5 * s, x + i * s, gy - 10.6 * s);
        ctx.stroke();
      }
    }

    lmCars(cx, gy) {
      const s = this.lmScale(3), ctx = this.ctx;
      const colors = ['#e53935', BRAND, '#fdd835', '#8e24aa'];
      for (let i = 0; i < 4; i++) {
        const x = cx + (i - 1.5) * 7 * s + 30 * s;
        ctx.fillStyle = colors[i];
        this.roundRect(x - 2.2 * s, gy - 1.8 * s, 4.4 * s, 1.3 * s, 0.4 * s);
        ctx.fill();
        this.roundRect(x - 1.3 * s, gy - 2.6 * s, 2.6 * s, 1 * s, 0.4 * s);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(x - 1.3 * s, gy - 0.45 * s, 0.45 * s, 0, Math.PI * 2);
        ctx.arc(x + 1.3 * s, gy - 0.45 * s, 0.45 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    lmPond(cx, gy) {
      const s = this.lmScale(2), ctx = this.ctx;
      const x = cx + 50 * s;
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.ellipse(x, gy + 2, 20 * s, 3 + 1.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(x - 6 * s, gy + 1, 5 * s, 1 + 0.4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      // Henry, the resident duckling, keeps watch from the bank.
      this.drawHenry(x + 22 * s, gy, Math.max(6 * this.scale, 40), { label: true, happy: this.henryHappy });
    }

    /** Henry: fluffy white duckling, big black eye, orange beak and webbed feet. Faces left. */
    drawHenry(x, gy, h, opts) {
      opts = opts || {};
      const ctx = this.ctx;
      const u = h / 10;
      const t = this.time || 0;
      const hop = opts.happy ? Math.abs(Math.sin(t * 9)) * 1.6 * u : 0;
      const bob = Math.sin(t * 2.6) * 0.12 * u;
      const y0 = gy - hop;
      const ORANGE = '#ff8a1c', ORANGE_DARK = '#e8700a';
      const FLUFF = '#fffaf0', SHADE = '#f1e8d8';

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.ellipse(x, gy + 1, 3.2 * u, 0.5 * u, 0, 0, Math.PI * 2); ctx.fill();

      // legs + webbed feet
      for (const [fx, shade] of [[x + 1.1 * u, true], [x - 0.9 * u, false]]) {
        ctx.strokeStyle = shade ? ORANGE_DARK : ORANGE;
        ctx.lineWidth = Math.max(1.5, 0.45 * u);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(fx, y0 - 2.2 * u); ctx.lineTo(fx, y0 - 0.3 * u); ctx.stroke();
        ctx.fillStyle = shade ? ORANGE_DARK : ORANGE;
        ctx.beginPath();
        ctx.moveTo(fx + 0.4 * u, y0 - 0.5 * u);
        ctx.lineTo(fx - 1.7 * u, y0 + 0.05 * u);
        ctx.quadraticCurveTo(fx - 0.6 * u, y0 + 0.35 * u, fx + 0.5 * u, y0);
        ctx.closePath();
        ctx.fill();
      }

      const by = y0 - 4.3 * u + bob;
      // tail tuft
      ctx.fillStyle = FLUFF;
      ctx.beginPath();
      ctx.moveTo(x + 2.4 * u, by - 0.6 * u);
      ctx.lineTo(x + 4 * u, by - 2.1 * u);
      ctx.lineTo(x + 3.6 * u, by + 0.9 * u);
      ctx.closePath();
      ctx.fill();
      // fluffy outline first, then the softly shaded body over it so only the fuzzy edge shows
      ctx.fillStyle = SHADE;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + 0.2 * u + Math.cos(a) * 2.85 * u, by + Math.sin(a) * 2.45 * u, 0.4 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(x - 0.8 * u, by - 1.2 * u, 0.4 * u, x, by, 3.4 * u);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, SHADE);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x + 0.2 * u, by, 3 * u, 2.6 * u, 0, 0, Math.PI * 2); ctx.fill();
      // wing
      const flap = opts.happy ? Math.sin(t * 18) * 0.5 : 0;
      ctx.save();
      ctx.translate(x + 1 * u, by - 0.6 * u);
      ctx.rotate(-0.3 + flap);
      ctx.fillStyle = SHADE;
      ctx.beginPath(); ctx.ellipse(0.6 * u, 0.4 * u, 1.6 * u, 1 * u, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // neck
      ctx.fillStyle = FLUFF;
      ctx.beginPath(); ctx.ellipse(x - 1 * u, by - 2.4 * u, 1.35 * u, 1.9 * u, -0.15, 0, Math.PI * 2); ctx.fill();
      // head
      const hx = x - 1.1 * u, hy = by - 4.1 * u;
      ctx.beginPath(); ctx.arc(hx, hy, 1.95 * u, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(hx - 0.8 * u + i * 0.4 * u, hy - 1.9 * u + Math.abs(i - 2) * 0.12 * u, 0.32 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      // beak
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.ellipse(hx - 2.2 * u, hy + 0.35 * u, 1.25 * u, 0.42 * u, 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ORANGE_DARK;
      ctx.beginPath(); ctx.ellipse(hx - 2 * u, hy + 0.72 * u, 0.95 * u, 0.22 * u, 0.05, 0, Math.PI * 2); ctx.fill();
      // eye
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(hx - 0.3 * u, hy - 0.35 * u, 0.55 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(hx - 0.45 * u, hy - 0.55 * u, 0.17 * u, 0, Math.PI * 2); ctx.fill();

      if (opts.label && h >= 36) {
        ctx.font = `800 ${Math.max(11, Math.min(18, u * 1.6))}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillText(opts.happy ? 'HENRY 🎉' : 'HENRY', x + 1, hy - 2.6 * u + 1);
        ctx.fillStyle = '#fff';
        ctx.fillText(opts.happy ? 'HENRY 🎉' : 'HENRY', x, hy - 2.6 * u);
      }
    }

    lmGas(cx, gy) {
      const s = this.lmScale(1.8), ctx = this.ctx;
      const x = cx + 45 * s;
      ctx.fillStyle = '#eceff1';
      ctx.fillRect(x - 14 * s, gy - 10 * s, 28 * s, 1.6 * s);
      ctx.fillStyle = '#f4511e';
      ctx.fillRect(x - 14 * s, gy - 11.5 * s, 28 * s, 1.5 * s);
      ctx.fillStyle = '#90a4ae';
      ctx.fillRect(x - 10 * s, gy - 8.4 * s, 0.8 * s, 8.4 * s);
      ctx.fillRect(x + 9 * s, gy - 8.4 * s, 0.8 * s, 8.4 * s);
      for (const px of [-4, 3]) {
        ctx.fillStyle = '#e53935';
        this.roundRect(x + px * s - 1.2 * s, gy - 4.5 * s, 2.4 * s, 4.5 * s, 0.4 * s);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + px * s - 0.8 * s, gy - 3.9 * s, 1.6 * s, 1.2 * s);
      }
    }

    lmSki(cx, gy) {
      const s = this.lmScale(1.4), ctx = this.ctx;
      const x = cx + 55 * s;
      ctx.fillStyle = '#eceff1';
      ctx.beginPath(); ctx.moveTo(x - 60 * s, gy); ctx.lineTo(x - 10 * s, gy - 40 * s); ctx.lineTo(x + 40 * s, gy); ctx.fill();
      ctx.fillStyle = '#8d6e63';
      ctx.fillRect(x + 8 * s, gy - 9 * s, 16 * s, 9 * s);
      ctx.fillStyle = '#4e342e';
      ctx.beginPath(); ctx.moveTo(x + 6 * s, gy - 9 * s); ctx.lineTo(x + 16 * s, gy - 16 * s); ctx.lineTo(x + 26 * s, gy - 9 * s); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 7 * s, gy - 10 * s, 18 * s, 1 * s);
      ctx.fillStyle = '#ffe082';
      ctx.fillRect(x + 11 * s, gy - 6 * s, 3 * s, 3 * s);
      ctx.fillRect(x + 18 * s, gy - 6 * s, 3 * s, 3 * s);
    }

    lmLighthouse(cx, gy) {
      const s = this.lmScale(1.2), ctx = this.ctx;
      const x = cx + 55 * s;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#fff' : '#c62828';
        const y0 = gy - i * 7 * s, w0 = 7 - i * 0.6, w1 = 7 - (i + 1) * 0.6;
        ctx.beginPath();
        ctx.moveTo(x - w0 * s, y0); ctx.lineTo(x + w0 * s, y0); ctx.lineTo(x + w1 * s, y0 - 7 * s); ctx.lineTo(x - w1 * s, y0 - 7 * s);
        ctx.fill();
      }
      ctx.fillStyle = '#ffeb3b';
      ctx.fillRect(x - 3 * s, gy - 40 * s, 6 * s, 5 * s);
      ctx.fillStyle = '#37474f';
      ctx.beginPath(); ctx.moveTo(x - 4 * s, gy - 40 * s); ctx.lineTo(x, gy - 45 * s); ctx.lineTo(x + 4 * s, gy - 40 * s); ctx.fill();
      ctx.fillStyle = 'rgba(255,235,59,0.25)';
      const a = Math.sin((this.time || 0) * 1.5) * 0.4;
      ctx.beginPath(); ctx.moveTo(x, gy - 37.5 * s);
      ctx.lineTo(x - 60 * s, gy - 37.5 * s + (a - 0.12) * 60 * s); ctx.lineTo(x - 60 * s, gy - 37.5 * s + (a + 0.12) * 60 * s);
      ctx.fill();
    }

    lmVolcano(cx, gy) {
      const s = this.lmScale(0.8), ctx = this.ctx;
      const x = cx + 60 * s;
      ctx.fillStyle = '#5d4037';
      ctx.beginPath(); ctx.moveTo(x - 110 * s, gy); ctx.lineTo(x - 18 * s, gy - 90 * s); ctx.lineTo(x + 18 * s, gy - 90 * s); ctx.lineTo(x + 110 * s, gy); ctx.fill();
      ctx.fillStyle = '#ff6d00';
      ctx.beginPath(); ctx.moveTo(x - 18 * s, gy - 90 * s); ctx.lineTo(x + 18 * s, gy - 90 * s); ctx.lineTo(x + 8 * s, gy - 60 * s); ctx.lineTo(x + 2 * s, gy - 72 * s); ctx.lineTo(x - 6 * s, gy - 55 * s); ctx.fill();
      ctx.fillStyle = 'rgba(120,120,120,0.5)';
      const t = this.time || 0;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(x + Math.sin(t + i) * 6 * s, gy - (100 + i * 14) * s - ((t * 10) % 14) * s, (8 + i * 3) * s, 0, Math.PI * 2); ctx.fill();
      }
    }

    lmRocket(cx, gy) {
      const s = this.lmScale(1.2), ctx = this.ctx;
      const x = cx + 55 * s;
      ctx.fillStyle = '#90a4ae';
      ctx.fillRect(x - 14 * s, gy - 2 * s, 28 * s, 2 * s);
      ctx.fillRect(x + 7 * s, gy - 40 * s, 2 * s, 38 * s);
      ctx.fillStyle = '#fafafa';
      this.roundRect(x - 4 * s, gy - 38 * s, 8 * s, 34 * s, 4 * s);
      ctx.fill();
      ctx.fillStyle = BRAND;
      ctx.beginPath(); ctx.moveTo(x - 4 * s, gy - 30 * s); ctx.lineTo(x, gy - 46 * s); ctx.lineTo(x + 4 * s, gy - 30 * s); ctx.fill();
      ctx.fillStyle = '#5e35b1';
      ctx.beginPath(); ctx.moveTo(x - 4 * s, gy - 12 * s); ctx.lineTo(x - 9 * s, gy - 3 * s); ctx.lineTo(x - 4 * s, gy - 4 * s); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 4 * s, gy - 12 * s); ctx.lineTo(x + 9 * s, gy - 3 * s); ctx.lineTo(x + 4 * s, gy - 4 * s); ctx.fill();
      ctx.fillStyle = BRAND_GREEN;
      ctx.beginPath(); ctx.arc(x, gy - 24 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
    }

    lmMoonBase(cx, gy) {
      const s = this.lmScale(1.2), ctx = this.ctx;
      // a huge moon hanging over the final target
      ctx.fillStyle = 'rgba(236,239,241,0.95)';
      ctx.beginPath(); ctx.arc(cx, gy - 80 * s, 30 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(176,190,197,0.8)';
      for (const [dx, dy, r] of [[-10, -6, 6], [9, 8, 4], [6, -14, 3], [-4, 14, 3]]) {
        ctx.beginPath(); ctx.arc(cx + dx * s, gy - 80 * s + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
      }
      const x = cx + 55 * s;
      ctx.fillStyle = '#cfd8dc';
      ctx.beginPath(); ctx.arc(x, gy, 14 * s, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(129,212,250,0.6)';
      ctx.beginPath(); ctx.arc(x, gy, 10 * s, Math.PI, 0); ctx.fill();
      ctx.fillStyle = BRAND;
      ctx.fillRect(x + 13 * s, gy - 22 * s, 0.8 * s, 22 * s);
      ctx.fillStyle = BRAND_GREEN;
      ctx.fillRect(x + 13.8 * s, gy - 22 * s, 7 * s, 4 * s);
    }

    lmOasis(cx, gy) {
      const s = this.lmScale(1.2), ctx = this.ctx;
      const x = cx + 50 * s;
      ctx.fillStyle = '#ffe0a3';
      ctx.beginPath(); ctx.ellipse(x, gy + 1, 40 * s, 3 + s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath(); ctx.ellipse(x, gy + 1, 18 * s, 2 + 0.6 * s, 0, 0, Math.PI * 2); ctx.fill();
      for (const dx of [-24, 22]) {
        ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = Math.max(2, 1.2 * s);
        ctx.beginPath(); ctx.moveTo(x + dx * s, gy); ctx.quadraticCurveTo(x + (dx + 3) * s, gy - 10 * s, x + (dx + 1) * s, gy - 20 * s); ctx.stroke();
        ctx.fillStyle = '#2e7d32';
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI + (i / 4) * Math.PI;
          ctx.beginPath(); ctx.ellipse(x + (dx + 1) * s + Math.cos(a) * 5 * s, gy - 20 * s + Math.sin(a) * 2 * s, 6 * s, 1.6 * s, a, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    lmPyramids(cx, gy) {
      const s = this.lmScale(0.9), ctx = this.ctx;
      const x = cx + 60 * s;
      for (const [dx, h, c] of [[-50, 55, '#d7b98e'], [10, 80, '#c69c6d'], [65, 40, '#e0c49a']]) {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(x + dx * s - h * s, gy); ctx.lineTo(x + dx * s, gy - h * s); ctx.lineTo(x + dx * s + h * s, gy); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath(); ctx.moveTo(x + dx * s, gy - h * s); ctx.lineTo(x + dx * s + h * s, gy); ctx.lineTo(x + dx * s + h * 0.3 * s, gy); ctx.fill();
      }
    }

    lmPirate(cx, gy) {
      const s = this.lmScale(1.1), ctx = this.ctx;
      const x = cx + 55 * s;
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath(); ctx.ellipse(x, gy + 2, 45 * s, 3 + s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6d4c41';
      ctx.beginPath(); ctx.moveTo(x - 22 * s, gy - 8 * s); ctx.lineTo(x + 22 * s, gy - 8 * s); ctx.lineTo(x + 16 * s, gy); ctx.lineTo(x - 16 * s, gy); ctx.fill();
      ctx.fillStyle = '#4e342e';
      ctx.fillRect(x - 1 * s, gy - 34 * s, 2 * s, 26 * s);
      ctx.fillStyle = '#fafafa';
      ctx.beginPath(); ctx.moveTo(x - 14 * s, gy - 31 * s); ctx.quadraticCurveTo(x - 4 * s, gy - 22 * s, x - 14 * s, gy - 12 * s); ctx.lineTo(x + 14 * s, gy - 12 * s); ctx.quadraticCurveTo(x + 4 * s, gy - 22 * s, x + 14 * s, gy - 31 * s); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.fillRect(x + 1 * s, gy - 40 * s, 8 * s, 5 * s);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x + 5 * s, gy - 37.5 * s, 1.2 * s, 0, Math.PI * 2); ctx.fill();
    }

    lmCastle(cx, gy) {
      const s = this.lmScale(1.0), ctx = this.ctx;
      const x = cx + 60 * s;
      ctx.fillStyle = '#9e9e9e';
      ctx.fillRect(x - 30 * s, gy - 30 * s, 60 * s, 30 * s);
      for (const dx of [-36, 24]) ctx.fillRect(x + dx * s, gy - 48 * s, 12 * s, 48 * s);
      ctx.fillStyle = '#757575';
      for (let i = 0; i < 6; i++) ctx.fillRect(x - 30 * s + i * 11 * s, gy - 34 * s, 6 * s, 4 * s);
      ctx.fillStyle = '#7e57c2';
      for (const dx of [-30, 30]) {
        ctx.beginPath(); ctx.moveTo(x + (dx - 8) * s, gy - 48 * s); ctx.lineTo(x + dx * s, gy - 62 * s); ctx.lineTo(x + (dx + 8) * s, gy - 48 * s); ctx.fill();
      }
      ctx.fillStyle = '#4e342e';
      ctx.beginPath(); ctx.arc(x, gy - 10 * s, 7 * s, Math.PI, 0); ctx.rect(x - 7 * s, gy - 10 * s, 14 * s, 10 * s); ctx.fill();
    }

    lmWindFarm(cx, gy) {
      const s = this.lmScale(1.0), ctx = this.ctx;
      const t = this.time || 0;
      for (const [dx, h] of [[20, 50], [55, 62], [90, 46]]) {
        const x = cx + dx * s, top = gy - h * s;
        ctx.strokeStyle = '#eceff1'; ctx.lineWidth = Math.max(2, 1.6 * s);
        ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, top); ctx.stroke();
        ctx.lineWidth = Math.max(1.5, 1.2 * s);
        for (let i = 0; i < 3; i++) {
          const a = t * 2 + dx + (i * Math.PI * 2) / 3;
          ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + Math.cos(a) * 18 * s, top + Math.sin(a) * 18 * s); ctx.stroke();
        }
      }
    }

    lmGlacier(cx, gy) {
      const s = this.lmScale(0.9), ctx = this.ctx;
      const x = cx + 60 * s;
      ctx.fillStyle = '#e1f5fe';
      ctx.beginPath(); ctx.moveTo(x - 80 * s, gy); ctx.lineTo(x - 50 * s, gy - 40 * s); ctx.lineTo(x - 20 * s, gy - 30 * s); ctx.lineTo(x + 10 * s, gy - 70 * s);
      ctx.lineTo(x + 45 * s, gy - 35 * s); ctx.lineTo(x + 80 * s, gy); ctx.fill();
      ctx.fillStyle = '#b3e5fc';
      ctx.beginPath(); ctx.moveTo(x + 10 * s, gy - 70 * s); ctx.lineTo(x + 45 * s, gy - 35 * s); ctx.lineTo(x + 80 * s, gy); ctx.lineTo(x + 20 * s, gy); ctx.fill();
    }

    lmStadium(cx, gy) {
      const s = this.lmScale(0.9), ctx = this.ctx;
      const x = cx + 70 * s;
      ctx.fillStyle = '#cfd8dc';
      ctx.beginPath(); ctx.moveTo(x - 60 * s, gy); ctx.lineTo(x - 55 * s, gy - 28 * s); ctx.quadraticCurveTo(x, gy - 40 * s, x + 55 * s, gy - 28 * s); ctx.lineTo(x + 60 * s, gy); ctx.fill();
      ctx.fillStyle = '#e53935';
      ctx.fillRect(x - 55 * s, gy - 18 * s, 110 * s, 5 * s);
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.max(8, 4 * s)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('ALLEN EAGLES', x, gy - 13.8 * s);
      ctx.fillStyle = '#fff';
      for (const dx of [-50, 50]) {
        ctx.fillRect(x + dx * s - 0.6 * s, gy - 60 * s, 1.2 * s, 32 * s);
        ctx.fillRect(x + dx * s - 5 * s, gy - 64 * s, 10 * s, 4 * s);
      }
    }

    lmElevator(cx, gy) {
      const s = this.lmScale(0.9), ctx = this.ctx;
      const x = cx + 60 * s;
      ctx.strokeStyle = '#90a4ae'; ctx.lineWidth = Math.max(2, 2 * s);
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, 0); ctx.stroke();
      ctx.fillStyle = '#3949ab';
      ctx.fillRect(x - 12 * s, gy - 10 * s, 24 * s, 10 * s);
      const climb = ((this.time || 0) * 30) % 200;
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(x - 4 * s, gy - (20 + climb) * s, 8 * s, 6 * s);
    }

    lmMars(cx, gy) {
      const s = this.lmScale(1.0), ctx = this.ctx;
      ctx.fillStyle = 'rgba(255,112,67,0.85)';
      ctx.beginPath(); ctx.arc(cx - 30 * s, gy - 90 * s, 22 * s, 0, Math.PI * 2); ctx.fill();
      const x = cx + 55 * s;
      ctx.fillStyle = '#bf360c';
      ctx.beginPath(); ctx.ellipse(x, gy + 1, 50 * s, 3 + s, 0, 0, Math.PI * 2); ctx.fill();
      for (const [dx, r] of [[-20, 14], [12, 20], [40, 10]]) {
        ctx.fillStyle = 'rgba(207,216,220,0.95)';
        ctx.beginPath(); ctx.arc(x + dx * s, gy, r * s, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'rgba(129,212,250,0.5)';
        ctx.beginPath(); ctx.arc(x + dx * s, gy, r * 0.7 * s, Math.PI, 0); ctx.fill();
      }
    }

    lmBlackHole(cx, gy) {
      const s = this.lmScale(1.0), ctx = this.ctx;
      const x = cx + 50 * s, y = gy - 70 * s;
      const t = this.time || 0;
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = `rgba(255,${120 + i * 20},0,${0.5 - i * 0.07})`;
        ctx.lineWidth = Math.max(1.5, 3 * s);
        ctx.beginPath(); ctx.ellipse(x, y, (40 - i * 4) * s, (12 - i) * s, 0.2 + t * 0.2 + i * 0.3, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x, y, 13 * s, 0, Math.PI * 2); ctx.fill();
    }

    lmGalaxyHQ(cx, gy) {
      const s = this.lmScale(1.1), ctx = this.ctx;
      // A golden super-office for the far jackpot
      const w = 70 * s, h = 60 * s, x = cx - w / 2;
      ctx.fillStyle = '#0b2f6b';
      ctx.fillRect(x, gy - h, w, h);
      ctx.fillStyle = '#ffd54f';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) if ((r + c) % 2) ctx.fillRect(x + 4 * s + c * 9.4 * s, gy - h + 6 * s + r * 9 * s, 5 * s, 5 * s);
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath(); ctx.moveTo(cx - 6 * s, gy - h); ctx.lineTo(cx, gy - h - 22 * s); ctx.lineTo(cx + 6 * s, gy - h); ctx.fill();
      ctx.font = `800 ${Math.max(9, 6 * s)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText('EGGERS GALAXY HQ', cx, gy - h - 26 * s);
    }

    lmBeacon(cx, gy) {
      const s = this.lmScale(1.0), ctx = this.ctx;
      const x = cx + 40 * s;
      ctx.fillStyle = '#37474f';
      ctx.beginPath(); ctx.moveTo(x - 6 * s, gy); ctx.lineTo(x - 2 * s, gy - 50 * s); ctx.lineTo(x + 2 * s, gy - 50 * s); ctx.lineTo(x + 6 * s, gy); ctx.fill();
      const pulse = 0.5 + 0.5 * Math.sin((this.time || 0) * 4);
      ctx.fillStyle = `rgba(0,191,165,${0.4 + 0.6 * pulse})`;
      ctx.beginPath(); ctx.arc(x, gy - 53 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(0,191,165,${0.15 * pulse})`;
      ctx.beginPath(); ctx.arc(x, gy - 53 * s, 14 * s, 0, Math.PI * 2); ctx.fill();
    }

    /** Shared helper: a little roadside sign with a label. */
    lmSign(x, gy, s, text, bg, fg) {
      const ctx = this.ctx;
      ctx.font = `800 ${Math.max(8, 2.6 * s)}px system-ui`;
      const w = ctx.measureText(text).width + 3 * s;
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(x - 0.4 * s, gy - 7 * s, 0.8 * s, 7 * s);
      ctx.fillStyle = bg;
      this.roundRect(x - w / 2, gy - 11 * s, w, 4.4 * s, 0.8 * s);
      ctx.fill();
      ctx.fillStyle = fg || '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, gy - 7.9 * s);
    }

    lmMarketStreet(cx, gy) {
      const s = this.lmScale(2.2), ctx = this.ctx;
      const x = cx + 30 * s, w = 34 * s, h = 12 * s;
      ctx.fillStyle = '#efe6d8';
      ctx.fillRect(x - w / 2, gy - h, w, h);
      ctx.fillStyle = '#8d6e63';
      ctx.fillRect(x - w / 2 - 1 * s, gy - h - 1.4 * s, w + 2 * s, 1.6 * s);
      // striped awning
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i % 2 ? '#ffffff' : '#c62828';
        ctx.fillRect(x - w / 2 + i * (w / 10), gy - h + 0.4 * s, w / 10, 2.2 * s);
      }
      ctx.fillStyle = '#90caf9';
      ctx.fillRect(x - w / 2 + 2 * s, gy - 7.5 * s, 9 * s, 5 * s);
      ctx.fillRect(x + w / 2 - 11 * s, gy - 7.5 * s, 9 * s, 5 * s);
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(x - 3 * s, gy - 8 * s, 6 * s, 8 * s);
      ctx.fillStyle = '#c62828';
      ctx.font = `800 ${Math.max(8, 2.8 * s)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Market Street', x, gy - h - 2.4 * s);
      // shopping carts
      for (const dx of [-24, -20]) {
        ctx.strokeStyle = '#9e9e9e';
        ctx.lineWidth = Math.max(1, 0.3 * s);
        ctx.strokeRect(x + dx * s, gy - 2.6 * s, 2.6 * s, 1.6 * s);
        ctx.fillStyle = '#424242';
        ctx.beginPath(); ctx.arc(x + dx * s + 0.5 * s, gy - 0.4 * s, 0.35 * s, 0, Math.PI * 2); ctx.arc(x + dx * s + 2.1 * s, gy - 0.4 * s, 0.35 * s, 0, Math.PI * 2); ctx.fill();
      }
    }

    lmCelebrationPark(cx, gy) {
      const s = this.lmScale(1.8), ctx = this.ctx;
      const x = cx + 40 * s;
      // pavilion
      ctx.fillStyle = '#795548';
      for (const dx of [-8, 8]) ctx.fillRect(x + dx * s - 0.5 * s, gy - 7 * s, 1 * s, 7 * s);
      ctx.fillStyle = '#2e7d32';
      ctx.beginPath(); ctx.moveTo(x - 11 * s, gy - 7 * s); ctx.lineTo(x, gy - 12 * s); ctx.lineTo(x + 11 * s, gy - 7 * s); ctx.fill();
      // playground slide
      const px = x + 18 * s;
      ctx.strokeStyle = '#1565c0'; ctx.lineWidth = Math.max(1.5, 0.5 * s);
      ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px, gy - 6 * s); ctx.stroke();
      ctx.strokeStyle = '#fdd835'; ctx.lineWidth = Math.max(2, 0.9 * s);
      ctx.beginPath(); ctx.moveTo(px, gy - 6 * s); ctx.quadraticCurveTo(px + 3 * s, gy - 1 * s, px + 7 * s, gy - 0.3 * s); ctx.stroke();
      // trees
      for (const dx of [-22, 30]) {
        ctx.fillStyle = '#6d4c41'; ctx.fillRect(x + dx * s - 0.5 * s, gy - 5 * s, 1 * s, 5 * s);
        ctx.fillStyle = '#43a047'; ctx.beginPath(); ctx.arc(x + dx * s, gy - 7 * s, 3.4 * s, 0, Math.PI * 2); ctx.fill();
      }
      this.lmSign(x - 36 * s, gy, s, 'CELEBRATION PARK', '#2e7d32');
    }

    lmWattersCreek(cx, gy) {
      const s = this.lmScale(2.2), ctx = this.ctx;
      const x = cx + 28 * s;
      // the creek and a little footbridge
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath(); ctx.ellipse(x - 16 * s, gy + 1, 9 * s, 1 + 0.6 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = Math.max(1.5, 0.6 * s);
      ctx.beginPath(); ctx.moveTo(x - 23 * s, gy - 0.3 * s); ctx.quadraticCurveTo(x - 16 * s, gy - 3.5 * s, x - 9 * s, gy - 0.3 * s); ctx.stroke();
      // stone restroom building
      const w = 16 * s, h = 8 * s;
      ctx.fillStyle = '#d7ccc8';
      ctx.fillRect(x - w / 2, gy - h, w, h);
      ctx.fillStyle = '#5d4037';
      ctx.beginPath(); ctx.moveTo(x - w / 2 - 1.5 * s, gy - h); ctx.lineTo(x, gy - h - 4 * s); ctx.lineTo(x + w / 2 + 1.5 * s, gy - h); ctx.fill();
      for (const [dx, icon] of [[-4, '🚹'], [4, '🚺']]) {
        ctx.fillStyle = '#37474f';
        ctx.fillRect(x + dx * s - 2 * s, gy - 6 * s, 4 * s, 6 * s);
        ctx.font = `${Math.max(7, 2.4 * s)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(icon, x + dx * s, gy - 6.5 * s);
      }
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.max(7, 1.5 * s)}px system-ui`;
      ctx.fillText('RESTROOMS', x, gy - h - 0.9 * s);
      this.lmSign(x + 22 * s, gy, s, 'WATTERS CREEK', '#5c6bc0');
    }

    lmOutlets(cx, gy) {
      const s = this.lmScale(1.6), ctx = this.ctx;
      const x = cx + 45 * s;
      const cols = ['#ef6c00', '#00897b', '#5e35b1', '#c62828', '#1565c0'];
      for (let i = 0; i < 5; i++) {
        const sx = x - 25 * s + i * 10 * s;
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(sx, gy - 10 * s, 9.5 * s, 10 * s);
        ctx.fillStyle = cols[i];
        ctx.fillRect(sx - 0.3 * s, gy - 7.5 * s, 10.1 * s, 1.6 * s);
        ctx.fillStyle = '#90caf9';
        ctx.fillRect(sx + 1.5 * s, gy - 5 * s, 6.5 * s, 5 * s);
      }
      ctx.fillStyle = '#37474f';
      ctx.fillRect(x - 26 * s, gy - 13.5 * s, 52 * s, 3.4 * s);
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.max(7, 2.2 * s)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('ALLEN PREMIUM OUTLETS', x, gy - 11.1 * s);
    }

    lmTower(cx, gy) {
      const s = this.lmScale(1.6), ctx = this.ctx;
      const x = cx + 40 * s;
      ctx.strokeStyle = '#78909c';
      ctx.lineWidth = Math.max(2, 0.6 * s);
      ctx.beginPath();
      ctx.moveTo(x - 6 * s, gy); ctx.lineTo(x - 3 * s, gy - 22 * s);
      ctx.moveTo(x + 6 * s, gy); ctx.lineTo(x + 3 * s, gy - 22 * s);
      ctx.moveTo(x - 5 * s, gy - 8 * s); ctx.lineTo(x + 5 * s, gy - 8 * s);
      ctx.moveTo(x - 4 * s, gy - 15 * s); ctx.lineTo(x + 4 * s, gy - 15 * s);
      ctx.stroke();
      ctx.fillStyle = '#b0bec5';
      this.roundRect(x - 7 * s, gy - 32 * s, 14 * s, 10 * s, 3 * s);
      ctx.fill();
      ctx.fillStyle = '#90a4ae';
      ctx.beginPath();
      ctx.moveTo(x - 7.5 * s, gy - 32 * s); ctx.lineTo(x, gy - 37 * s); ctx.lineTo(x + 7.5 * s, gy - 32 * s);
      ctx.fill();
      ctx.fillStyle = BRAND;
      ctx.font = `bold ${Math.max(8, 2.6 * s)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('KICK', x, gy - 26 * s);
    }

    lmPizza(cx, gy) {
      const s = this.lmScale(2), ctx = this.ctx;
      const x = cx + 45 * s;
      ctx.fillStyle = '#ffccbc';
      ctx.fillRect(x - 7 * s, gy - 7 * s, 14 * s, 7 * s);
      ctx.fillStyle = '#d84315';
      ctx.beginPath();
      ctx.moveTo(x - 9 * s, gy - 7 * s); ctx.lineTo(x, gy - 12 * s); ctx.lineTo(x + 9 * s, gy - 7 * s);
      ctx.fill();
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(x - 1.5 * s, gy - 4 * s, 3 * s, 4 * s);
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath();
      ctx.moveTo(x + 3 * s, gy - 6 * s); ctx.lineTo(x + 6.5 * s, gy - 6 * s); ctx.lineTo(x + 4.75 * s, gy - 2.5 * s);
      ctx.fill();
    }

    lmBillboard(cx, gy) {
      const s = this.lmScale(1.4), ctx = this.ctx;
      const x = cx + 60 * s;
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(x - 10 * s, gy - 10 * s, 1.2 * s, 10 * s);
      ctx.fillRect(x + 9 * s, gy - 10 * s, 1.2 * s, 10 * s);
      ctx.fillStyle = BRAND;
      ctx.fillRect(x - 16 * s, gy - 22 * s, 32 * s, 12 * s);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.max(7, 3 * s)}px system-ui`;
      ctx.fillText('CLICK WISE DESIGN', x, gy - 16.5 * s);
      ctx.fillStyle = BRAND_GREEN;
      ctx.font = `${Math.max(6, 2 * s)}px system-ui`;
      ctx.fillText('websites that score ⚽', x, gy - 12.5 * s);
    }

    lmOffice(cx, gy) {
      const s = this.lmScale(2.2), ctx = this.ctx;
      const w = 46 * s, h = 26 * s;
      const x = cx - w / 2;
      // Lawn path
      ctx.fillStyle = '#e0d6c2';
      ctx.fillRect(cx - 3 * s, gy - 0.5, 6 * s, 3);
      // Main block
      ctx.fillStyle = '#eceff1';
      ctx.fillRect(x, gy - h, w, h);
      ctx.fillStyle = BRAND;
      ctx.fillRect(x, gy - h - 2 * s, w, 2.5 * s);
      // Windows
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 8; col++) {
          if (row === 2 && (col === 3 || col === 4)) continue;
          ctx.fillStyle = (row + col) % 3 === 0 ? '#bbdefb' : '#90caf9';
          ctx.fillRect(x + 2.5 * s + col * 5.4 * s, gy - h + 5 * s + row * 7 * s, 4 * s, 4.5 * s);
        }
      }
      // Door
      ctx.fillStyle = '#37474f';
      ctx.fillRect(cx - 4 * s, gy - 7 * s, 8 * s, 7 * s);
      ctx.fillStyle = '#90caf9';
      ctx.fillRect(cx - 3.4 * s, gy - 6.4 * s, 3 * s, 6.4 * s);
      ctx.fillRect(cx + 0.4 * s, gy - 6.4 * s, 3 * s, 6.4 * s);
      // Sign on the roof
      const sw = 40 * s, sh = 7 * s;
      ctx.fillStyle = '#ffffff';
      this.roundRect(cx - sw / 2, gy - h - 11 * s, sw, sh, 1.5 * s);
      ctx.fill();
      ctx.strokeStyle = BRAND;
      ctx.lineWidth = Math.max(1, 0.5 * s);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = `800 ${Math.max(8, 3.6 * s)}px system-ui`;
      ctx.fillStyle = BRAND;
      ctx.fillText('CLICK WISE', cx - 5.5 * s, gy - h - 6.2 * s);
      ctx.fillStyle = BRAND_GREEN;
      ctx.fillText('DESIGN', cx + 11.5 * s, gy - h - 6.2 * s);
      // Cursor logo
      const lx = cx - 18 * s, ly = gy - h - 10.2 * s;
      ctx.fillStyle = BRAND;
      ctx.beginPath();
      ctx.moveTo(lx, ly); ctx.lineTo(lx, ly + 5 * s); ctx.lineTo(lx + 1.3 * s, ly + 3.8 * s); ctx.lineTo(lx + 3.4 * s, ly + 3.6 * s);
      ctx.closePath();
      ctx.fill();
      // Flag
      ctx.fillStyle = '#607d8b';
      ctx.fillRect(x + w + 3 * s, gy - 30 * s, 0.6 * s, 30 * s);
      ctx.fillStyle = BRAND_GREEN;
      ctx.beginPath();
      ctx.moveTo(x + w + 3.6 * s, gy - 30 * s);
      ctx.lineTo(x + w + 11 * s, gy - 27.5 * s);
      ctx.lineTo(x + w + 3.6 * s, gy - 25 * s);
      ctx.fill();
    }

    lmDowntown(cx, gy) {
      const s = this.lmScale(1.2), ctx = this.ctx;
      const r = seeded(5200);
      for (let i = 0; i < 9; i++) {
        const w = (10 + r() * 10) * s, h = (30 + r() * 60) * s;
        const x = cx - 80 * s + i * 18 * s;
        ctx.fillStyle = ['#546e7a', '#607d8b', '#455a64', '#78909c'][i % 4];
        ctx.fillRect(x, gy - h, w, h);
        ctx.fillStyle = 'rgba(255,241,118,0.6)';
        for (let wy = gy - h + 4 * s; wy < gy - 6 * s; wy += 6 * s) {
          ctx.fillRect(x + 2 * s, wy, w - 4 * s, 2 * s);
        }
      }
    }

    lmAirport(cx, gy) {
      const s = this.lmScale(1.2), ctx = this.ctx;
      const x = cx + 70 * s;
      ctx.fillStyle = '#90a4ae';
      ctx.fillRect(x - 3 * s, gy - 35 * s, 6 * s, 35 * s);
      ctx.fillStyle = '#4dd0e1';
      ctx.fillRect(x - 7 * s, gy - 43 * s, 14 * s, 8 * s);
      // Plane taking off
      const px = cx - 60 * s, py = gy - 40 * s;
      ctx.fillStyle = '#fafafa';
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-0.25);
      this.roundRect(-20 * s, -2.5 * s, 40 * s, 5 * s, 2.5 * s);
      ctx.fill();
      ctx.fillStyle = BRAND;
      ctx.beginPath();
      ctx.moveTo(-4 * s, 0); ctx.lineTo(4 * s, 0); ctx.lineTo(-6 * s, 12 * s); ctx.closePath();
      ctx.moveTo(-18 * s, -2 * s); ctx.lineTo(-14 * s, -2 * s); ctx.lineTo(-20 * s, -9 * s); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    lmMountain(cx, gy) {
      const s = this.lmScale(0.7), ctx = this.ctx;
      ctx.fillStyle = '#8d6e63';
      ctx.beginPath();
      ctx.moveTo(cx - 160 * s, gy); ctx.lineTo(cx + 40 * s, gy - 140 * s); ctx.lineTo(cx + 220 * s, gy);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(cx + 40 * s, gy - 140 * s);
      ctx.lineTo(cx + 12 * s, gy - 120 * s); ctx.lineTo(cx + 30 * s, gy - 115 * s);
      ctx.lineTo(cx + 45 * s, gy - 122 * s); ctx.lineTo(cx + 68 * s, gy - 118 * s);
      ctx.closePath();
      ctx.fill();
    }

    lmDish(cx, gy) {
      const s = this.lmScale(1.2), ctx = this.ctx;
      const x = cx + 60 * s;
      ctx.fillStyle = '#9e9e9e';
      ctx.fillRect(x - 1.5 * s, gy - 18 * s, 3 * s, 18 * s);
      ctx.fillStyle = '#eeeeee';
      ctx.beginPath();
      ctx.ellipse(x, gy - 24 * s, 16 * s, 8 * s, -0.6, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#ffd600';
      ctx.beginPath();
      ctx.arc(x + 6 * s, gy - 32 * s, 1.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    drawObjects() {
      const { ctx, groundY } = this;
      for (const o of this.objects) {
        if (!this.visible(o.x, 300)) continue;
        const x = this.sx(o.x);
        if (o.type === 'pad') {
          const w = Math.max(o.w * this.scale, 26);
          const h = Math.max(1.2 * this.scale, 7);
          ctx.fillStyle = '#263238';
          ctx.fillRect(x - w / 2 + 2, groundY - h, 3, h);
          ctx.fillRect(x + w / 2 - 5, groundY - h, 3, h);
          ctx.fillStyle = BRAND;
          this.roundRect(x - w / 2, groundY - h - 4, w, 6, 3);
          ctx.fill();
          ctx.fillStyle = BRAND_GREEN;
          ctx.font = `bold ${Math.max(10, Math.min(16, w / 6))}px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText('▲ BOING', x, groundY - h - 9);
        } else if (o.type === 'puddle') {
          const w = Math.max(o.w * this.scale, 26);
          ctx.fillStyle = '#6d8fa6';
          ctx.beginPath();
          ctx.ellipse(x, groundY + 4, w / 2, Math.max(3, Math.min(w * 0.08, 10)), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath();
          ctx.ellipse(x - w * 0.12, groundY + 3, w * 0.16, 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          this.decor(o, x);
        }
      }
    }

    decor(o, x) {
      const ctx = this.ctx;
      const gy = this.groundY;
      const s = Math.max(this.scale, 1.6);
      if (o.v === 0 || o.v === 1) {
        const h = (o.v === 0 ? 8 : 11) * s;
        ctx.fillStyle = '#6d4c41';
        ctx.fillRect(x - 0.5 * s, gy - h * 0.45, 1 * s, h * 0.45);
        ctx.fillStyle = o.v === 0 ? '#2e7d32' : '#388e3c';
        ctx.beginPath();
        if (o.v === 0) {
          ctx.arc(x, gy - h * 0.65, h * 0.32, 0, Math.PI * 2);
        } else {
          ctx.moveTo(x - h * 0.28, gy - h * 0.35); ctx.lineTo(x, gy - h); ctx.lineTo(x + h * 0.28, gy - h * 0.35);
        }
        ctx.fill();
      } else if (o.v === 2) {
        ctx.fillStyle = '#43a047';
        ctx.beginPath();
        ctx.arc(x - 1.2 * s, gy - 0.6 * s, 1.4 * s, Math.PI, 0);
        ctx.arc(x + 1.2 * s, gy - 0.6 * s, 1.6 * s, Math.PI, 0);
        ctx.fill();
      } else {
        // Cow
        ctx.fillStyle = '#fafafa';
        this.roundRect(x - 1.3 * s, gy - 1.9 * s, 2.6 * s, 1.2 * s, 0.4 * s);
        ctx.fill();
        ctx.fillRect(x - 1.1 * s, gy - 0.8 * s, 0.3 * s, 0.8 * s);
        ctx.fillRect(x + 0.8 * s, gy - 0.8 * s, 0.3 * s, 0.8 * s);
        ctx.fillStyle = '#212121';
        ctx.beginPath();
        ctx.arc(x - 0.3 * s, gy - 1.5 * s, 0.35 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fafafa';
        this.roundRect(x + 1.1 * s, gy - 2.3 * s, 0.9 * s, 0.8 * s, 0.25 * s);
        ctx.fill();
      }
    }

    // ---- Jason -----------------------------------------------------------
    // Modelled on the real Jason: deep brown skin, short white hair, grey goatee, stocky build.
    drawJason(j) {
      const ctx = this.ctx;
      const s = this.scale;
      const outfit = C.OUTFITS.find((o) => o.id === this.equipped.outfit) || C.OUTFITS[0];
      const baseX = this.sx(0);
      if (baseX < -300 || baseX > this.W + 300) return;
      const lift = j.jump || 0;
      const P0 = (x, y) => [this.sx(x), this.sy(y + lift)];
      const cloth = (shade) => (shade ? this.darken(outfit.shorts, 0.25) : outfit.shorts);

      const hip = { x: 0, y: HIP_Y };
      const legPts = (a1, bend) => {
        const knee = { x: hip.x + Math.sin(a1) * THIGH, y: hip.y - Math.cos(a1) * THIGH };
        const a2 = a1 - bend;
        const foot = { x: knee.x + Math.sin(a2) * SHIN, y: knee.y - Math.cos(a2) * SHIN };
        return { knee, foot, a2 };
      };

      const drawFoot = (fx, fy, a2, shade) => {
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(-a2);
        if (outfit.sandals) {
          // Bare foot in a black flip-flop.
          ctx.fillStyle = shade ? SKIN_DARK : SKIN;
          this.roundRect(-0.06 * s, -0.07 * s, 0.26 * s, 0.09 * s, 0.045 * s);
          ctx.fill();
          ctx.fillStyle = '#111';
          this.roundRect(-0.07 * s, 0.015 * s, 0.29 * s, 0.035 * s, 0.015 * s);
          ctx.fill();
          ctx.strokeStyle = '#111';
          ctx.lineWidth = Math.max(1, 0.02 * s);
          ctx.beginPath();
          ctx.moveTo(0.0, 0.015 * s); ctx.lineTo(0.12 * s, -0.055 * s); ctx.lineTo(0.15 * s, 0.015 * s);
          ctx.stroke();
        } else {
          ctx.fillStyle = outfit.shoe ? (shade ? this.darken(outfit.shoe, 0.25) : outfit.shoe) : shade ? '#111' : '#222';
          this.roundRect(-0.06 * s, -0.06 * s, 0.26 * s, 0.11 * s, 0.05 * s);
          ctx.fill();
          if (!outfit.shoe) {
            ctx.fillStyle = BRAND_GREEN;
            ctx.fillRect(-0.01 * s, 0.03 * s, 0.18 * s, 0.02 * s);
          }
        }
        ctx.restore();
      };

      const drawLeg = (a1, bend, shade) => {
        const { knee, foot, a2 } = legPts(a1, bend);
        const [hx, hy] = P0(hip.x, hip.y);
        const [kx, ky] = P0(knee.x, knee.y);
        const [fx, fy] = P0(foot.x, foot.y);
        ctx.lineCap = 'round';
        if (outfit.pants) {
          ctx.strokeStyle = shade ? SKIN_DARK : SKIN;
          ctx.lineWidth = 0.1 * s;
          ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
          ctx.strokeStyle = cloth(shade);
          ctx.lineWidth = 0.19 * s;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(kx + (fx - kx) * 0.8, ky + (fy - ky) * 0.8); ctx.stroke();
        } else {
          ctx.strokeStyle = shade ? SKIN_DARK : SKIN;
          ctx.lineWidth = 0.14 * s;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
          ctx.strokeStyle = cloth(shade);
          ctx.lineWidth = 0.2 * s;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + (kx - hx) * 0.55, hy + (ky - hy) * 0.55); ctx.stroke();
          ctx.strokeStyle = outfit.socks;
          ctx.lineWidth = 0.13 * s;
          ctx.beginPath(); ctx.moveTo(kx + (fx - kx) * 0.45, ky + (fy - ky) * 0.45); ctx.lineTo(fx, fy); ctx.stroke();
        }
        drawFoot(fx, fy, a2, shade);
      };

      const drawArm = (shoulder, a1, bend, shade) => {
        const elbow = { x: shoulder.x + Math.sin(a1) * 0.3, y: shoulder.y - Math.cos(a1) * 0.3 };
        const a2 = a1 + bend;
        const hand = { x: elbow.x + Math.sin(a2) * 0.28, y: elbow.y - Math.cos(a2) * 0.28 };
        const [sx0, sy0] = P0(shoulder.x, shoulder.y);
        const [ex, ey] = P0(elbow.x, elbow.y);
        const [hx, hy] = P0(hand.x, hand.y);
        ctx.lineCap = 'round';
        ctx.strokeStyle = shade ? SKIN_DARK : SKIN;
        ctx.lineWidth = 0.11 * s;
        ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = shade ? SKIN_DARK : SKIN;
        ctx.beginPath(); ctx.arc(hx, hy, 0.065 * s, 0, Math.PI * 2); ctx.fill();
        const long = outfit.longSleeves || outfit.pattern === 'suit' || outfit.pattern === 'astro';
        ctx.strokeStyle = shade ? this.darken(outfit.shirt, 0.2) : outfit.shirt;
        ctx.lineWidth = 0.15 * s;
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        if (long) { ctx.lineTo(ex, ey); ctx.lineTo(ex + (hx - ex) * 0.72, ey + (hy - ey) * 0.72); }
        else ctx.lineTo(sx0 + (ex - sx0) * 0.5, sy0 + (ey - sy0) * 0.5);
        ctx.stroke();
      };

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(baseX + 0.05 * s, this.groundY + 3, 0.5 * s / (1 + lift), 0.07 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      const lean = j.lean || 0;
      const shoulder = { x: Math.sin(lean) * 0.5, y: HIP_Y + Math.cos(lean) * 0.5 };

      // Back arm, then both legs: the torso is drawn over the hip joints so they never poke through.
      drawArm({ x: shoulder.x - 0.05, y: shoulder.y }, j.backArm, 0.5, true);
      drawLeg(j.backLeg, j.backBend, true);
      drawLeg(j.frontLeg, j.frontBend, false);

      // Neck
      const neck = { x: shoulder.x + Math.sin(lean) * 0.06, y: shoulder.y + 0.06 };
      const headC = { x: neck.x + Math.sin(lean) * 0.14 + 0.01, y: neck.y + 0.16 };
      {
        const [ax, ay] = P0(shoulder.x, shoulder.y - 0.05);
        const [bx, by] = P0(headC.x, headC.y);
        ctx.strokeStyle = SKIN;
        ctx.lineWidth = 0.15 * s;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }

      // Torso (stocky)
      ctx.save();
      const [tx0, ty0] = P0(0, HIP_Y - 0.12);
      ctx.translate(tx0, ty0);
      ctx.rotate(lean);
      ctx.fillStyle = outfit.shorts;
      this.roundRect(-0.21 * s, -0.12 * s, 0.42 * s, 0.22 * s, 0.06 * s);
      ctx.fill();
      ctx.fillStyle = outfit.shirt;
      this.roundRect(-0.22 * s, -0.68 * s, 0.44 * s, 0.66 * s, 0.13 * s);
      ctx.fill();
      this.torsoPattern(outfit, s);
      ctx.restore();

      // Head (drawn in head-local space, a touch oversized for character)
      const [nx, ny] = P0(headC.x, headC.y);
      const hr = 0.145 * s;
      ctx.save();
      ctx.translate(nx, ny);
      ctx.scale(1.12, 1.12);
      if (outfit.pattern === 'astro') {
        ctx.fillStyle = '#cfd8dc';
        this.roundRect(-0.32 * s, 0.1 * s, 0.13 * s, 0.36 * s, 0.04 * s);
        ctx.fill();
      }
      const headShape = () => {
        ctx.beginPath();
        ctx.arc(0, 0, hr, 0, Math.PI * 2);
        ctx.ellipse(0.03 * s, 0.06 * s, hr * 0.85, hr * 0.7, 0, 0, Math.PI * 2);
      };
      ctx.fillStyle = SKIN;
      headShape();
      ctx.fill();
      // Short white hair: a close crop on top and round the back, clipped to the skull.
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, -0.004 * s, hr * 1.05, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = HAIR;
      ctx.beginPath();
      ctx.moveTo(-hr * 1.2, 0.02 * s);
      ctx.lineTo(-hr * 0.5, 0.0);
      ctx.quadraticCurveTo(-hr * 0.1, -hr * 0.62, hr * 0.62, -hr * 0.6);
      ctx.lineTo(hr * 1.2, -hr * 0.7);
      ctx.lineTo(hr * 1.2, -hr * 1.3);
      ctx.lineTo(-hr * 1.2, -hr * 1.3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // ear
      ctx.fillStyle = SKIN_DARK;
      ctx.beginPath(); ctx.ellipse(-0.02 * s, 0.01 * s, 0.028 * s, 0.038 * s, 0, 0, Math.PI * 2); ctx.fill();
      // nose
      ctx.beginPath(); ctx.arc(hr * 0.95, 0.02 * s, 0.03 * s, 0, Math.PI * 2); ctx.fill();
      // eye + brow
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(0.085 * s, -0.02 * s, 0.016 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = BEARD;
      ctx.lineWidth = 0.016 * s;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0.055 * s, -0.055 * s); ctx.lineTo(0.12 * s, -0.052 * s); ctx.stroke();
      // grey goatee: moustache, chin and the line joining them
      ctx.fillStyle = BEARD;
      this.roundRect(0.07 * s, 0.045 * s, 0.085 * s, 0.022 * s, 0.011 * s);
      ctx.fill();
      ctx.beginPath(); ctx.ellipse(0.09 * s, 0.12 * s, 0.05 * s, 0.038 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 0.02 * s;
      ctx.beginPath(); ctx.moveTo(0.145 * s, 0.06 * s); ctx.lineTo(0.125 * s, 0.115 * s); ctx.stroke();
      // mouth
      ctx.strokeStyle = '#3e2117';
      ctx.lineWidth = 0.013 * s;
      ctx.beginPath();
      if (j.cheer) ctx.arc(0.105 * s, 0.078 * s, 0.026 * s, 0, Math.PI);
      else { ctx.moveTo(0.085 * s, 0.083 * s); ctx.quadraticCurveTo(0.11 * s, 0.092 * s, 0.135 * s, 0.078 * s); }
      ctx.stroke();
      if (outfit.pattern === 'astro') {
        ctx.fillStyle = 'rgba(179,229,252,0.35)';
        ctx.strokeStyle = '#eceff1';
        ctx.lineWidth = 0.03 * s;
        ctx.beginPath(); ctx.arc(0.02 * s, 0.02 * s, hr * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();

      // Front arm
      drawArm({ x: shoulder.x + 0.03, y: shoulder.y }, j.frontArm, 0.6, false);

      if (j.nameTag) {
        const [tx, ty] = P0(0.05, 2.3);
        ctx.font = `800 ${Math.max(11, 0.12 * s)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillText('JASON', tx + 1, ty + 1);
        ctx.fillStyle = '#fff';
        ctx.fillText('JASON', tx, ty);
      }
    }

    darken(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      const f = (c) => Math.round(c * (1 - amt));
      return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
    }

    torsoPattern(outfit, s) {
      const ctx = this.ctx;
      const p = outfit.pattern;
      if (p === 'gi') {
        const n = parseInt(outfit.shirt.slice(1), 16);
        const white = ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) > 450;
        // Undershirt in the V of the jacket
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.moveTo(-0.08 * s, -0.68 * s); ctx.lineTo(0.16 * s, -0.68 * s); ctx.lineTo(0.05 * s, -0.45 * s);
        ctx.closePath();
        ctx.fill();
        // Thick lapels
        ctx.strokeStyle = white ? '#dcdcd8' : '#2f2f33';
        ctx.lineWidth = 0.05 * s;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(-0.1 * s, -0.68 * s); ctx.lineTo(0.06 * s, -0.3 * s); ctx.lineTo(0.08 * s, -0.12 * s);
        ctx.moveTo(0.18 * s, -0.68 * s); ctx.lineTo(0.04 * s, -0.4 * s);
        ctx.stroke();
        if (outfit.medal) {
          // Lanyard: red, white and blue
          ctx.lineCap = 'round';
          for (const [x0, x1] of [[-0.06, 0.03], [0.14, 0.05]]) {
            ctx.strokeStyle = '#1e40c8';
            ctx.lineWidth = 0.04 * s;
            ctx.beginPath(); ctx.moveTo(x0 * s, -0.7 * s); ctx.lineTo(x1 * s, -0.47 * s); ctx.stroke();
            ctx.strokeStyle = '#e53935';
            ctx.lineWidth = 0.012 * s;
            ctx.beginPath(); ctx.moveTo(x0 * s, -0.7 * s); ctx.lineTo(x1 * s, -0.47 * s); ctx.stroke();
          }
          ctx.fillStyle = '#e53935';
          ctx.fillRect(0.02 * s, -0.48 * s, 0.045 * s, 0.04 * s);
          // Medal (octagon)
          const gold = outfit.medal === 'gold';
          const mx = 0.043 * s, my = -0.37 * s, mr = 0.065 * s;
          const g = ctx.createLinearGradient(mx - mr, my - mr, mx + mr, my + mr);
          g.addColorStop(0, gold ? '#fff3b0' : '#f2f2f2');
          g.addColorStop(1, gold ? '#c9a000' : '#9a9a9a');
          ctx.fillStyle = g;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = Math.PI / 8 + (i * Math.PI) / 4;
            ctx.lineTo(mx + Math.cos(a) * mr, my + Math.sin(a) * mr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = gold ? '#a07c00' : '#7d7d7d';
          ctx.fillRect(mx - mr * 0.45, my - mr * 0.45, mr * 0.9, mr * 0.9);
        }
        // Belt with knot and hanging ends
        ctx.fillStyle = outfit.belt;
        ctx.fillRect(-0.23 * s, -0.11 * s, 0.46 * s, 0.065 * s);
        this.roundRect(0.03 * s, -0.13 * s, 0.08 * s, 0.09 * s, 0.02 * s);
        ctx.fill();
        ctx.save();
        ctx.translate(0.07 * s, -0.06 * s);
        for (const rot of [0.25, -0.15]) {
          ctx.save();
          ctx.rotate(rot);
          ctx.fillStyle = outfit.belt;
          ctx.fillRect(-0.02 * s, 0, 0.045 * s, 0.17 * s);
          ctx.fillStyle = outfit.beltTip;
          ctx.fillRect(-0.02 * s, 0.11 * s, 0.045 * s, 0.06 * s);
          ctx.restore();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-0.23 * s, -0.11 * s, 0.46 * s, 0.065 * s);
      } else if (p === 'stripes') {
        ctx.fillStyle = outfit.alt;
        for (let i = -1; i <= 1; i++) ctx.fillRect(i * 0.12 * s - 0.025 * s, -0.68 * s, 0.05 * s, 0.64 * s);
      } else if (p === 'suit') {
        ctx.fillStyle = outfit.alt;
        ctx.beginPath();
        ctx.moveTo(0.02 * s, -0.68 * s); ctx.lineTo(0.17 * s, -0.68 * s); ctx.lineTo(0.08 * s, -0.4 * s);
        ctx.fill();
        ctx.fillStyle = outfit.tie || '#c62828';
        ctx.fillRect(0.065 * s, -0.64 * s, 0.035 * s, 0.26 * s);
      } else if (p === 'flowers') {
        ctx.fillStyle = outfit.alt;
        const pts = [[-0.12, -0.56], [0.1, -0.5], [-0.04, -0.32], [0.12, -0.2], [-0.14, -0.16]];
        for (const [x, y] of pts) {
          ctx.beginPath(); ctx.arc(x * s, y * s, 0.035 * s, 0, Math.PI * 2); ctx.fill();
        }
      } else if (p === 'shine') {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(-0.15 * s, -0.6 * s, 0.05 * s, 0.5 * s);
      } else if (p === 'astro') {
        ctx.fillStyle = outfit.alt;
        ctx.fillRect(-0.06 * s, -0.5 * s, 0.14 * s, 0.1 * s);
      } else {
        // Click Wise cursor logo on the chest
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(0.05 * s, -0.56 * s); ctx.lineTo(0.05 * s, -0.45 * s); ctx.lineTo(0.08 * s, -0.48 * s); ctx.lineTo(0.12 * s, -0.48 * s);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawSweetSpot(st) {
      const ctx = this.ctx;
      const y = this.sy(P.SWEET_SPOT);
      const band = Math.max(3, st.sweetWidth * 0.35 * this.scale);
      const x0 = this.sx(0.2), x1 = this.sx(1.05);
      const hot = st.ball && Math.abs(st.ball.y - P.SWEET_SPOT) < st.sweetWidth * 0.35;
      ctx.fillStyle = hot ? 'rgba(76,175,80,0.35)' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(x0, y - band, x1 - x0, band * 2);
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = hot ? 'rgba(76,175,80,0.95)' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillStyle = hot ? '#1b5e20' : 'rgba(255,255,255,0.85)';
      ctx.fillText('SWEET SPOT', x1 + 6, y + 4);
      // Out-of-reach line
      const ry = this.sy(2.5);
      ctx.strokeStyle = 'rgba(229,57,53,0.35)';
      ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.moveTo(x0, ry); ctx.lineTo(x1, ry); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(229,57,53,0.6)';
      ctx.fillText('TOO HIGH', x1 + 6, ry + 4);
    }

    // ---- Ball + trail -----------------------------------------------------
    drawBall(x, y, rot, time) {
      const ctx = this.ctx;
      const ball = C.BALLS.find((b) => b.id === this.equipped.ball) || C.BALLS[0];
      const r = Math.max(0.11 * this.scale, 5);
      const X = this.sx(x), Y = this.sy(y) - r * 0.2;
      // shadow
      const sh = Math.max(0.15, 1 - y / 30);
      ctx.fillStyle = `rgba(0,0,0,${0.22 * sh})`;
      ctx.beginPath();
      ctx.ellipse(X, this.groundY + 2, r * sh, r * 0.3 * sh, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(rot);
      if (ball.style === 'egg') {
        ctx.fillStyle = ball.base;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.9, r * 1.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ball.patch;
        ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.4, r * 0.12, 0, Math.PI * 2); ctx.arc(-r * 0.3, r * 0.2, r * 0.09, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#c9b48a';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.9, r * 1.15, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (ball.style === 'fire') {
        const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.4);
        g.addColorStop(0, '#fffde7');
        g.addColorStop(0.4, ball.patch);
        g.addColorStop(0.75, ball.base);
        g.addColorStop(1, 'rgba(255,61,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r * (1.35 + 0.1 * Math.sin(time * 30)), 0, Math.PI * 2); ctx.fill();
      } else if (ball.style === 'mastery') {
        // Mastery Pro Ball: deep navy with a gold star, gold seams and a travelling glint.
        const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
        g.addColorStop(0, '#3a6fd8'); g.addColorStop(1, ball.base);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ball.patch;
        ctx.lineWidth = Math.max(1, r * 0.08);
        ctx.beginPath(); ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.98, r * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = ball.patch;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? r * 0.22 : r * 0.52;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        const glint = (time * 1.5) % (Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        this.star(Math.cos(glint) * r * 0.7, Math.sin(glint) * r * 0.7, Math.max(2, r * 0.22));
      } else if (ball.style === 'star') {
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#fff3c4');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ball.patch;
        for (const [dx, dy, sz] of [[0, 0, 0.42], [0.62, -0.45, 0.2], [-0.6, 0.48, 0.2], [-0.55, -0.5, 0.15], [0.55, 0.55, 0.15]]) {
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const rr = (i % 2 ? sz * 0.45 : sz) * r;
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            ctx.lineTo(dx * r + Math.cos(a) * rr, dy * r + Math.sin(a) * rr);
          }
          ctx.closePath(); ctx.fill();
        }
      } else if (ball.style === 'diamond') {
        ctx.fillStyle = ball.base;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + time * 0.8;
          ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.75)' : 'rgba(0,172,193,0.35)';
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2);
          ctx.lineTo(Math.cos(a + 0.78) * r * 1.2, Math.sin(a + 0.78) * r * 1.2); ctx.fill();
        }
        ctx.restore();
        ctx.fillStyle = '#fff';
        this.star(-r * 0.35, -r * 0.4, Math.max(2, r * 0.25));
      } else if (ball.style === 'galaxy') {
        const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
        g.addColorStop(0, '#7c4dff'); g.addColorStop(0.6, '#311b92'); g.addColorStop(1, ball.base);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 9; i++) {
          const a = i * 2.4 + time * 0.5, d = r * (0.2 + (i % 4) * 0.2);
          ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, Math.max(0.6, r * 0.05), 0, Math.PI * 2); ctx.fill();
        }
      } else if (ball.style === 'blackhole') {
        ctx.strokeStyle = ball.patch;
        ctx.lineWidth = Math.max(1.5, r * 0.22);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.5, r * 0.45, time * 2, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,145,0,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.stroke();
      } else if (ball.style === 'henry') {
        ctx.fillStyle = ball.base;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, r * 0.22, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = ball.patch;
        ctx.beginPath(); ctx.ellipse(-r * 0.75, r * 0.12, r * 0.42, r * 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(-r * 0.12, -r * 0.2, r * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(-r * 0.18, -r * 0.27, r * 0.07, 0, Math.PI * 2); ctx.fill();
      } else if (ball.style === 'disco') {
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
        const step = r / 2.5;
        for (let gx = -r; gx < r; gx += step) {
          for (let gy2 = -r; gy2 < r; gy2 += step) {
            const k = Math.sin(gx * 13.1 + gy2 * 7.7 + time * 9);
            ctx.fillStyle = k > 0.6 ? '#ffffff' : k > 0 ? '#cfd8dc' : '#90a4ae';
            ctx.fillRect(gx, gy2, step - 0.6, step - 0.6);
          }
        }
        ctx.restore();
      } else if (ball.style === 'planet') {
        ctx.strokeStyle = '#d7ccc8';
        ctx.lineWidth = Math.max(1.5, r * 0.18);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.6, r * 0.45, -0.3, Math.PI, Math.PI * 2); ctx.stroke();
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
        g.addColorStop(0, '#ffe0b2'); g.addColorStop(1, ball.base);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(141,110,99,0.5)';
        ctx.fillRect(-r, -r * 0.15, r * 2, r * 0.18);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.6, r * 0.45, -0.3, 0, Math.PI); ctx.stroke();
      } else if (ball.style === 'moon') {
        ctx.fillStyle = ball.base;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ball.patch;
        for (const [dx, dy, rr] of [[-0.35, -0.3, 0.25], [0.35, 0.2, 0.2], [0.05, 0.5, 0.14], [0.4, -0.45, 0.12]]) {
          ctx.beginPath(); ctx.arc(dx * r, dy * r, rr * r, 0, Math.PI * 2); ctx.fill();
        }
      } else if (ball.style === 'beach') {
        const cols = ['#ff5252', '#ffffff', '#ffeb3b', '#ffffff', '#40c4ff', '#ffffff'];
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = cols[i];
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, (i * Math.PI) / 3, ((i + 1) * Math.PI) / 3); ctx.fill();
        }
      } else {
        const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, ball.base);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ball.patch;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
          const px = Math.cos(a) * r * 0.3, py = Math.sin(a) * r * 0.3;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        for (let i = 0; i < 5; i++) {
          const a = (i * 2 * Math.PI) / 5 + Math.PI / 2;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, r * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      if (0.11 * this.scale < 6) {
        // Halo so a tiny far-away ball is still easy to follow.
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X, Y, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
      if (ball.style !== 'fire') {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        if (ball.style !== 'egg') { ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.stroke(); }
      }
    }

    drawTrail(trail, time) {
      const type = this.equipped.trail;
      if (!trail || trail.length < 4 || type === 'none') return;
      const ctx = this.ctx;
      const n = trail.length / 2;
      if (type === 'dots') {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < n; i += 3) {
          ctx.beginPath();
          ctx.arc(this.sx(trail[i * 2]), this.sy(trail[i * 2 + 1]), 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (type === 'rainbow') {
        const cols = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
        ctx.lineCap = 'round';
        cols.forEach((c, k) => {
          ctx.strokeStyle = c;
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const X = this.sx(trail[i * 2]), Y = this.sy(trail[i * 2 + 1]) + (k - 2.5) * 3;
            if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
          }
          ctx.stroke();
        });
        ctx.globalAlpha = 1;
      } else if (type === 'sparkle') {
        for (let i = 0; i < n; i += 2) {
          const a = i / n;
          const X = this.sx(trail[i * 2]) + Math.sin(i * 12.9 + time * 8) * 6;
          const Y = this.sy(trail[i * 2 + 1]) + Math.cos(i * 7.3 + time * 8) * 6;
          ctx.fillStyle = `rgba(255,${200 + ((i * 13) % 55)},120,${a})`;
          this.star(X, Y, 2 + a * 3);
        }
      } else if (type === 'feathers') {
        for (let i = 0; i < n; i += 4) {
          const a = i / n;
          const X = this.sx(trail[i * 2]) + Math.sin(i * 3.1 + time * 3) * 8 * (1 - a);
          const Y = this.sy(trail[i * 2 + 1]) + (1 - a) * 14;
          ctx.save();
          ctx.translate(X, Y);
          ctx.rotate(Math.sin(i + time * 4) * 0.8);
          ctx.fillStyle = `rgba(255,250,240,${0.2 + a * 0.8})`;
          ctx.beginPath(); ctx.ellipse(0, 0, 6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = `rgba(200,190,170,${a})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
          ctx.restore();
        }
      } else if (type === 'stars') {
        for (let i = 0; i < n; i += 3) {
          const a = i / n;
          ctx.fillStyle = `rgba(255,214,0,${a})`;
          this.star(this.sx(trail[i * 2]), this.sy(trail[i * 2 + 1]), 3 + a * 5);
        }
      } else if (type === 'confetti') {
        const cols = ['#047dc3', '#4caf50', '#ffd600', '#e53935', '#ab47bc'];
        for (let i = 0; i < n; i += 2) {
          const a = i / n;
          ctx.globalAlpha = a;
          ctx.fillStyle = cols[i % cols.length];
          ctx.fillRect(this.sx(trail[i * 2]) + Math.sin(i * 7.3) * 10, this.sy(trail[i * 2 + 1]) + Math.cos(i * 5.1) * 10, 5, 3);
        }
        ctx.globalAlpha = 1;
      } else if (type === 'comet') {
        for (let i = 0; i < n; i++) {
          const a = i / n;
          ctx.fillStyle = `rgba(${Math.round(120 + a * 135)},${Math.round(200 + a * 55)},255,${a * 0.6})`;
          ctx.beginPath(); ctx.arc(this.sx(trail[i * 2]), this.sy(trail[i * 2 + 1]), 1 + a * 10, 0, Math.PI * 2); ctx.fill();
        }
      } else if (type === 'aura') {
        for (let i = 0; i < n; i += 3) {
          const a = i / n;
          ctx.strokeStyle = `rgba(255,${180 + Math.round(a * 60)},40,${a * 0.7})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(this.sx(trail[i * 2]), this.sy(trail[i * 2 + 1]), 3 + (1 - a) * 12, 0, Math.PI * 2); ctx.stroke();
        }
      } else if (type === 'supernova') {
        for (let i = 0; i < n; i++) {
          const a = i / n;
          const hue = (200 + i * 4 + time * 120) % 360;
          ctx.fillStyle = `hsla(${hue},100%,${55 + a * 25}%,${a * 0.55})`;
          ctx.beginPath(); ctx.arc(this.sx(trail[i * 2]), this.sy(trail[i * 2 + 1]), 2 + a * 14, 0, Math.PI * 2); ctx.fill();
        }
        if (n > 2) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          this.star(this.sx(trail[(n - 1) * 2]), this.sy(trail[(n - 1) * 2 + 1]), 10 + Math.sin(time * 20) * 3);
        }
      } else if (type === 'cosmic') {
        for (let i = 0; i < n; i += 2) {
          const a = i / n;
          const hue = (i * 7 + time * 60) % 360;
          ctx.fillStyle = `hsla(${hue},90%,70%,${a})`;
          const X = this.sx(trail[i * 2]) + Math.sin(i * 3.7 + time * 5) * 7;
          const Y = this.sy(trail[i * 2 + 1]) + Math.cos(i * 2.3 + time * 5) * 7;
          this.star(X, Y, 2 + a * 4);
        }
      } else if (type === 'flame') {
        for (let i = 0; i < n; i++) {
          const a = i / n;
          ctx.fillStyle = `rgba(255,${Math.round(80 + a * 150)},0,${a * 0.7})`;
          ctx.beginPath();
          ctx.arc(this.sx(trail[i * 2]), this.sy(trail[i * 2 + 1]), 2 + a * 7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    star(x, y, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 ? r * 0.4 : r;
        const a = (i * Math.PI) / 4;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }

    drawParticles() {
      const ctx = this.ctx;
      const maxPx = { confetti: 9, dust: 5, splash: 5, boing: 6, kick: 5 };
      for (const p of this.particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        const r = Math.min(maxPx[p.type] || 6, Math.max(2, p.size * this.scale));
        if (p.type === 'confetti') ctx.fillRect(this.sx(p.x) - r / 2, this.sy(p.y) - r / 2, r, r * 0.6);
        else {
          ctx.beginPath();
          ctx.arc(this.sx(p.x), this.sy(p.y), r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  EK.Renderer = Renderer;
})();
