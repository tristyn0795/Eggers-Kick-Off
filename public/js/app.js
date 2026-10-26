/* Eggers Kick Off — UI, profiles, networking and multiplayer. */
(function () {
  'use strict';
  const P = window.EKPhysics;
  const C = window.EKCatalog;
  const EKCareer = window.EKCareer;
  const CH = window.EKChallenges;
  const EK = window.EK;
  const sfx = EK.sfx;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(n || 0).toLocaleString();
  const fmtM = (n) => `${Math.floor(n || 0).toLocaleString()} m`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // In the browser the game talks to the server it was loaded from. Inside the iOS/Android
  // app shell the files are bundled, so app-config.js points EK_API_BASE at the live server.
  const API_BASE = String(window.EK_API_BASE || '').replace(/\/$/, '');
  const IS_APP = !!window.EK_API_BASE;

  const local = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  const S = {
    online: false,
    token: local.get('ek_token', null),
    player: null,
    ranks: null,
    offline: Object.assign(C.newProfile(), local.get('ek_offline', {})),
    shopProfile: null,
    ws: null,
    wsOk: false,
    wsBackoff: 1000,
    onlineCount: 0,
    room: null,
    roomChat: [],
    blocked: local.get('ek_blocked', {}), // playerId -> name; their chat and feed posts are hidden
    roomFinal: null,
    wantRoom: null,
    current: null,
    lbType: 'round',
    shopTab: 'upgrades',
    pendingAfterName: null,
    screen: 'menu',
  };

  function saveOffline() { local.set('ek_offline', S.offline); }

  // ---- Halloween Night: Oct 31 (the player's local date) the whole game goes spooky ----
  // Preview it any day with ?theme=halloween in the address.
  const themePreview = new URLSearchParams(location.search).get('theme');
  const isHalloweenNight = (d) => d.getMonth() === 9 && d.getDate() === 31;
  function applyTheme() {
    const now = new Date();
    const theme = themePreview === 'halloween' || isHalloweenNight(now) ? 'halloween' : null;
    EK.theme = theme;
    document.body.classList.toggle('theme-halloween', theme === 'halloween');
    const strip = document.getElementById('seasonStrip');
    if (!strip) return;
    let html = '';
    if (theme === 'halloween') {
      html = '🎃 <b>Happy Halloween!</b> Tonight only, the field goes spooky, with candy and decorations at every landmark. 👻';
    } else if (now.getMonth() === 9) {
      const days = 31 - now.getDate();
      html = `🎃 <b>Coming Oct 31: Halloween Night!</b> For one night the whole field goes spooky, with candy and decorations at every landmark. ${days === 1 ? 'Tomorrow!' : `${days} days to go.`}`;
    }
    strip.innerHTML = html;
    strip.classList.toggle('hidden', !html);
  }
  applyTheme();
  setInterval(applyTheme, 60000); // flips on (and off) at midnight

  /** ⭐ badge for a prestige rank. */
  function stars(n) {
    n = n | 0;
    return n > 0 ? ` <span class="prestige-badge" title="Prestige ${n}">⭐${n}</span>` : '';
  }

  /** Drop the online login and its backup from this device (sign out / account deleted). */
  function forgetOnlineProfile() {
    S.token = null; S.player = null; S.ranks = null;
    local.del('ek_token'); local.del('ek_backup');
    if (S.ws) S.ws.close();
  }

  const isBlocked = (id) => !!(id && S.blocked[id]);

  /** Report / block menu for another player (names, chat, leaderboard). */
  function playerMenu(id, name, context) {
    if (!id || (S.player && id === S.player.id)) return;
    const blocked = isBlocked(id);
    modal(`<h2>${esc(name)}</h2>
      <p class="muted">Blocking hides their chat and live-feed posts on this device. Reporting sends their name${context ? ' and the message' : ''} to the Click Wise team for review.</p>
      ${context ? `<blockquote class="quote">${esc(context)}</blockquote>` : ''}
      <div class="actions">
        <button class="btn ${blocked ? '' : 'danger'}" data-modal="${blocked ? 'unblock' : 'block'}">${blocked ? '✅ Unblock' : '🚫 Block'}</button>
        <button class="btn danger" data-modal="report">🚩 Report</button>
        <button class="btn" data-modal="close">Cancel</button>
      </div>`, (a) => {
      if (a === 'block') { S.blocked[id] = name; local.set('ek_blocked', S.blocked); toast(`${name} is blocked`, 'good'); renderChat(); goBackFromModal(); }
      else if (a === 'unblock') { delete S.blocked[id]; local.set('ek_blocked', S.blocked); toast(`${name} is unblocked`, 'good'); renderChat(); goBackFromModal(); }
      else if (a === 'report') reportPlayer(id, name, context);
      else goBackFromModal();
    });
  }

  function reportPlayer(id, name, context) {
    const reasons = [['name', 'Offensive name'], ['chat', 'Abusive chat'], ['cheating', 'Cheating'], ['other', 'Something else']];
    modal(`<h2>🚩 Report ${esc(name)}</h2><p class="muted">Why are you reporting them?</p>
      <div class="actions column">${reasons.map(([k, l]) => `<button class="btn" data-modal="r:${k}">${l}</button>`).join('')}
      <button class="btn" data-modal="close">Cancel</button></div>`, async (a) => {
      if (!a.startsWith('r:')) { goBackFromModal(); return; }
      if (!S.player) { toast('Sign in to report players', 'error'); goBackFromModal(); return; }
      try {
        await api('/api/report', { playerId: id, reason: a.slice(2), context: context || '' });
        toast('Thanks — the report was sent. You can also block them.', 'good');
      } catch (err) { toast(err.message, 'error'); }
      goBackFromModal();
    });
  }

  /** Store the latest server profile, and keep its signed backup on this device. */
  function setPlayer(p) {
    S.player = p;
    if (p && p.backup) local.set('ek_backup', p.backup);
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------
  const hud = {
    last: {},
    range: 0,
    show(mode, opts) {
      opts = opts || {};
      $('#hud').classList.remove('hidden');
      $('#pillKick').classList.toggle('hidden', mode === 'replay');
      $('#pillScore').classList.toggle('hidden', mode === 'replay');
      $('#pillReplay').classList.toggle('hidden', mode !== 'replay');
      $('#pillCoins').classList.toggle('hidden', mode === 'replay');
      this.roundCoins = 0;
      this.setCombo(0, 1);
      this.golden(false);
      this.power(null, 0);
      $('#hudCoins').textContent = '+0';
      $('#hudReplay').textContent = opts.replay || '';
      $('#pillBeat').classList.toggle('hidden', !opts.beat);
      $('#hudBeat').textContent = opts.beat ? fmt(opts.beat) : '';
      $('#pillVs').classList.toggle('hidden', !opts.vs);
      if (opts.vs) {
        $('#hudVsName').textContent = `${opts.vs.avatar} ${opts.vs.name.split(' ')[0].toUpperCase()}`;
        $('#hudVs').textContent = '0';
      }
      $('#hudMute').textContent = sfx.muted ? '🔇' : '🔊';
      this.last = {};
      this.range = 0;
      this.hideResult();
    },
    hide() {
      this.golden(false);
      this.power(null, 0);
      $('#hud').classList.add('hidden');
      $('#roomPanel').classList.add('hidden');
      this.hideResult();
    },
    set(id, v) {
      if (this.last[id] === v) return;
      this.last[id] = v;
      document.getElementById(id).textContent = v;
    },
    update(s) {
      this.set('hudKick', s.kicks === Infinity ? `#${s.index + 1}` : `${s.index + 1}/${s.kicks}`);
      this.set('hudScore', fmt(s.total));
      const w = s.wind;
      this.set('hudWind', w === 0 ? 'calm' : `${w > 0 ? '→' : '←'} ${Math.abs(w).toFixed(1)}`);
      const inFlight = s.phase === 'flight';
      const distEl = $('#distance');
      if (this.last.flight !== inFlight) {
        this.last.flight = inFlight;
        distEl.classList.toggle('hidden', !inFlight);
      }
      if (inFlight) this.set('distance', fmtM(Math.max(0, s.ballX)));
      const ff = inFlight && !s.fast && s.mode === 'play';
      if (this.last.ff !== ff) { this.last.ff = ff; $('#ffHint').classList.toggle('hidden', !ff); }
      this.track(Math.max(0, s.ballX));
      // Split Shot: a second marker for the other ball.
      const b2 = s.ball2X != null ? `${Math.min(100, (Math.max(0, s.ball2X) / this.range) * 100).toFixed(2)}%` : '';
      if (this.last.b2 !== b2) {
        this.last.b2 = b2;
        const el = $('#trackBall2');
        if (el) {
          el.classList.toggle('hidden', !b2);
          if (b2) el.style.left = b2;
        }
      }
    },
    track(x) {
      const range = Math.min(P.FIELD_LENGTH, Math.max(4500, Math.ceil((x + 400) / (x > 20000 ? 10000 : 1000)) * (x > 20000 ? 10000 : 1000)));
      if (range !== this.range) {
        this.range = range;
        $('#trackMarks').innerHTML = P.TARGETS.filter((t) => t.x <= range && !t.beacon).map((t) => (t.jackpot
          ? `<span class="mk office" style="left:${(t.x / range) * 100}%" title="${esc(t.name)}">🌌</span>`
          : t.office
          ? `<span class="mk office" style="left:${(t.x / range) * 100}%" title="${esc(t.name)}">🏢</span>`
          : `<span class="mk" style="left:${(t.x / range) * 100}%;background:${t.color}" title="${esc(t.name)}"></span>`)).join('');
      }
      const pct = `${Math.min(100, (x / range) * 100).toFixed(2)}%`;
      if (this.last.pct !== pct) {
        this.last.pct = pct;
        $('#trackBall').style.left = pct;
        $('#trackFill').style.width = pct;
      }
    },
    showResult(r) {
      const bad = r.label === 'WHIFF!' || r.label === 'SHANKED';
      $('#resLabel').textContent = r.label;
      $('#resLabel').classList.toggle('bad', bad);
      $('#resDist').textContent = fmtM(r.distance);
      const t = r.target;
      $('#resTarget').classList.toggle('hidden', !t);
      if (t) $('#resTarget').textContent = `🎯 ${t.ring} · ${t.name} +${t.points}`;
      if (r.points == null) $('#resPoints').innerHTML = '';
      else $('#resPoints').innerHTML = `+${fmt(r.points)} pts${r.final ? ' <small>final ball ×2</small>' : ''}`;
      const sub = [];
      if (r.replay) sub.push(esc(r.replay));
      else if (r.firstBounce) sub.push(`First bounce ${fmtM(r.firstBounce)}`);
      if (r.extra) sub.push(esc(r.extra));
      if (r.earned) {
        const got = r.earned.coins + (r.earned.levelBonus || 0);
        const e = r.earned;
        const why = [];
        if (e.golden) why.push(`🌟 golden ×${C.GOLDEN_MULT}`);
        if (e.combo > 1) why.push(`🔥 combo ×${e.combo}`);
        if (e.veteran > 1) why.push(`🎖️ veteran +${Math.round((e.veteran - 1) * 100)}%`);
        if (got > 0) sub.push(`<span class="coin-gain">+${fmt(e.coins)} 🪙</span>${why.length ? ` <small class="coin-why">(${why.join(' · ')})</small>` : ''}`);
        this.setCombo(e.streak, e.combo);
        if (r.earned.levelAfter > r.earned.levelBefore) {
          sub.push(`<span class="best">⬆️ LEVEL ${r.earned.levelAfter}! +${fmt(r.earned.levelBonus)} 🪙</span>`);
          sfx.levelUp();
        }
        this.countCoins(got);
      }
      const pw = r.power && P.POWER_BALLS[r.power];
      if (pw) {
        const what = {
          magnet: r.magnetFrom ? `pulled in from ${fmtM(r.magnetFrom)}` : 'no target close enough',
          fire: '+35% distance', bouncy: '+25% distance', meteor: '+45% distance',
          split: r.split ? `second ball ${fmtM(r.split.distance)}${r.split.target ? ` · 🎯 ${esc(r.split.target.ring.toLowerCase())} at ${esc(r.split.target.name)}` : ''}` : '',
          pinata: 'cracked open!',
        }[r.power] || '';
        sub.push(`<span class="power-gain">${pw.icon} ${esc(pw.name)}${what ? `: ${what}` : ''}</span>`);
      }
      if (r.pinata) sub.push(`<span class="best">${pinataText(r.pinata)}</span>`);
      if (r.newBestKick) sub.push('<span class="best">★ NEW PERSONAL BEST</span>');
      $('#resSub').innerHTML = sub.join(' · ');
      const ms = r.milestones || [];
      const chs = r.challenges || [];
      $('#resMs').classList.toggle('hidden', !ms.length && !chs.length);
      const msLines = ms.length > 3
        ? ms.slice(0, 2).map((m) => `🏅 <b>${esc(m.name)}</b> +${fmt(m.reward)} 🪙`)
          .concat(`<span class="res-more">🏅 +${ms.length - 2} more milestones · +${fmt(ms.slice(2).reduce((n, m) => n + m.reward, 0))} 🪙</span>`)
        : ms.map((m) => `🏅 <b>${esc(m.name)}</b> +${fmt(m.reward)} 🪙`);
      $('#resMs').innerHTML = msLines
        .concat(chs.map((c) => `✅ ${c.weekly ? 'Weekly' : 'Daily'} challenge: <b>${esc(c.text)}</b> +${fmt(c.reward)} 🪙`)).join('<br>');
      if (chs.length) setTimeout(() => sfx.levelUp(), 250);
      if (r.henry) toast('🪿 Henry loves it! QUACK!', 'good');
      const vs = this.onResult ? this.onResult(r) : null;
      $('#resVs').classList.toggle('hidden', !vs);
      if (vs) $('#resVs').innerHTML = vs;
      $('#result').classList.remove('hidden');
      $('#distance').classList.add('hidden');
      this.last.flight = false;
    },
    hideResult() { $('#result').classList.add('hidden'); },
    /** Tick the in-round coin counter up so earnings feel continuous. */
    /** Show the live combo while a streak of good kicks is running. */
    setCombo(streak, mult) {
      const on = streak >= 2;
      $('#pillCombo').classList.toggle('hidden', !on);
      if (on) {
        $('#hudCombo').textContent = `×${mult}`;
        const pill = $('#pillCombo');
        pill.classList.remove('bump');
        void pill.offsetWidth;
        pill.classList.add('bump');
      }
    },
    golden(on) {
      $('#hud').classList.toggle('golden', !!on);
    },
    /** PERFECT streak toward a Power Ball, or the Power Ball that's loaded. */
    power(id, run) {
      const pw = id && P.POWER_BALLS[id];
      const pill = $('#pillPower');
      pill.classList.toggle('hidden', !pw && !run);
      pill.classList.toggle('armed', !!pw);
      $('#hud').classList.toggle('powered', !!pw);
      $('#hudPowerLbl').textContent = pw ? 'POWER' : 'PERFECT';
      const next = P.nextPowerAt(run || 0);
      const pinataNext = next % P.PINATA_STREAK === 0;
      $('#hudPower').innerHTML = pw ? `${pw.icon}<span class="pw-name"> ${pw.short}</span>` : `${run}/${next}${pinataNext ? '<span class="pw-name"> 🪅</span>' : ''}`;
      pill.title = pw ? pw.desc : pinataNext
        ? `${P.PINATA_STREAK} PERFECT kicks in a row break out the Piñata Ball`
        : `${P.POWER_STREAK} PERFECT kicks in a row load a Power Ball`;
    },
    countCoins(amount) {
      if (!amount) return;
      const el = $('#hudCoins');
      const from = this.roundCoins || 0;
      const to = from + amount;
      this.roundCoins = to;
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 700);
        el.textContent = `+${fmt(from + (to - from) * k)}`;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      const pill = $('#pillCoins');
      pill.classList.remove('bump');
      void pill.offsetWidth;
      pill.classList.add('bump');
      sfx.coin();
    },
    hint(text) {
      const el = $('#hint');
      el.classList.toggle('hidden', !text);
      if (text) el.textContent = text;
    },
    flash() {
      const f = $('#fade');
      f.classList.add('on');
      requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
    },
    toastSmall(t) { toast(t, 'small'); },
  };

  const game = new EK.Game($('#game'), hud);
  EK.game = game;

  // -------------------------------------------------------------------------
  // Toasts & feed
  // -------------------------------------------------------------------------
  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = `toast ${kind || ''}`;
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'small' ? 1600 : 3200);
  }
  function addFeed(html) {
    const feed = $('#feed');
    const el = document.createElement('div');
    el.className = 'feed-item';
    el.innerHTML = html;
    feed.appendChild(el);
    // Phones only have room for a couple of lines; desktops show more.
    const maxItems = window.innerWidth <= 560 ? 2 : 4;
    while (feed.children.length > maxItems) feed.firstChild.remove();
    setTimeout(() => el.remove(), 8200);
  }

  // -------------------------------------------------------------------------
  // Networking
  // -------------------------------------------------------------------------
  async function api(path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    if (S.token) headers.Authorization = `Bearer ${S.token}`;
    const res = await fetch(API_BASE + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function checkOnline() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(API_BASE + '/api/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      S.online = res.ok;
      const health = res.ok ? await res.json() : {};
      const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return '1'; } }, set(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* unavailable */ } } };
      if (health.rules && health.rules !== P.RULES_VERSION) {
        // The game was updated while this copy was open (or this app build is out of date).
        if (!IS_APP && !ss.get('ek_reloaded')) { ss.set('ek_reloaded', '1'); location.reload(); return false; }
        S.online = false;
        S.needsUpdate = true;
      } else if (res.ok) ss.set('ek_reloaded', null);
    } catch (e) {
      S.online = false;
    }
    if (S.online && S.token) await loadMe();
    if (S.online && !S.ws) connectWs();
    renderMenu();
    return S.online;
  }

  async function loadMe() {
    try {
      const me = await api('/api/me');
      setPlayer(me.player);
      S.ranks = me.ranks;
    } catch (e) {
      if (e.status === 401) await recoverProfile();
    }
  }

  /**
   * The server doesn't recognise this device's login. Never just throw progress away:
   * try to rebuild the profile from the signed backup this device keeps.
   */
  async function recoverProfile() {
    const backup = local.get('ek_backup', null);
    if (backup && S.token) {
      try {
        const res = await api('/api/restore', { token: S.token, backup });
        setPlayer(res.player);
        toast(`Welcome back, ${res.player.name}! Your progress was restored from this device.`, 'good');
        return;
      } catch (err) {
        if (err.status === 409) {
          toast('Please log in with your kicker name and password.', 'error');
        }
        if (err.status === 410) { forgetOnlineProfile(); return; } // the player deleted this account
      }
    }
    S.player = null;
    if (!backup) {
      // Nothing to restore from: this login can never work again.
      S.token = null;
      local.del('ek_token');
    }
  }

  function connectWs() {
    if (!S.online) return;
    const base = API_BASE ? new URL(API_BASE) : location;
    const proto = base.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(`${proto}://${base.host}/ws`); } catch (e) { return; }
    S.ws = ws;
    ws.onopen = () => {
      S.wsOk = true;
      S.wsBackoff = 1000;
      wsSend({ t: 'hello', token: S.token });
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      onWs(msg);
    };
    ws.onclose = () => {
      S.wsOk = false;
      S.ws = null;
      renderStatus();
      setTimeout(connectWs, S.wsBackoff);
      S.wsBackoff = Math.min(S.wsBackoff * 2, 20000);
    };
  }
  function wsSend(msg) {
    if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg));
  }

  function onWs(msg) {
    switch (msg.t) {
      case 'hello':
        S.onlineCount = msg.online;
        renderStatus();
        if (msg.ok) {
          const code = S.wantRoom || (S.room && S.room.code);
          if (code) { S.wantRoom = null; wsSend({ t: 'room:join', code }); }
        }
        break;
      case 'online':
        S.onlineCount = msg.count;
        renderStatus();
        break;
      case 'feed': {
        if (S.player && msg.playerId === S.player.id && game.playing) break; // you already saw it land
        if (S.room && S.room.members.some((m) => m.id === msg.playerId)) break; // shown as a room update instead
        if (isBlocked(msg.playerId)) break;
        const t = msg.target;
        const where = t ? ` — ${t.ring === 'BULLSEYE' ? '🎯 BULLSEYE' : t.ring.toLowerCase()} at ${esc(t.name)}` : '';
        const pw = msg.power && P.POWER_BALLS[msg.power];
        addFeed(`${pw ? pw.icon : '🔥'} <b>${esc(msg.name)}</b> kicked ${fmtM(msg.distance)}${pw ? ` with a ${esc(pw.name)}` : ''}${where}`);
        break;
      }
      case 'room:state':
        S.room = msg;
        if (msg.status === 'lobby') S.roomFinal = null;
        renderRoom();
        renderRoomPanel();
        break;
      case 'room:started':
        S.roomFinal = null;
        beginOnlineRound({ kind: 'room', roundId: msg.roundId, baseSeed: msg.baseSeed, upgrades: msg.upgrades });
        break;
      case 'room:kick':
        if (S.player && msg.id !== S.player.id && !isBlocked(msg.id)) {
          const pw = msg.power && P.POWER_BALLS[msg.power];
          addFeed(`${pw ? pw.icon : '👟'} <b>${esc(msg.name)}</b>: ${fmtM(msg.distance)} <span style="opacity:.7">(+${fmt(msg.points)})</span>`);
        }
        break;
      case 'room:final':
        S.roomFinal = msg.standings;
        if (!game.playing) renderRoom();
        break;
      case 'room:chat':
        if (isBlocked(msg.id)) break;
        S.roomChat.push(msg);
        if (S.roomChat.length > 40) S.roomChat.shift();
        renderChat();
        if (game.playing) addFeed(`💬 <b>${esc(msg.name)}</b>: ${esc(msg.text)}`);
        break;
      case 'room:left':
        S.room = null;
        S.roomChat = [];
        renderRoom();
        renderRoomPanel();
        break;
      case 'error':
        toast(msg.error, 'error');
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Screens
  // -------------------------------------------------------------------------
  function show(name) {
    S.screen = name;
    $$('.screen').forEach((el) => el.classList.toggle('hidden', el.id !== `screen-${name}`));
    game.inputBlocked = !!name && (game.mode === 'play' || game.mode === 'replay');
    game.covered = !!name && name !== 'menu' && name !== 'modal' && window.innerWidth <= 560;
    if (name) hud.hint(null);
  }
  function hideScreens() {
    S.screen = null;
    $$('.screen').forEach((el) => el.classList.add('hidden'));
    game.inputBlocked = false;
    game.covered = false;
  }

  function activeProfile() {
    return S.player || S.offline;
  }

  function goMenu() {
    game.attract(activeProfile().equipped);
    hud.hide();
    S.current = null;
    renderMenu();
    show('menu');
  }

  function renderStatus() {
    const el = $('#onlineStatus');
    if (!el) return;
    if (S.needsUpdate) {
      el.innerHTML = `<span class="dot off"></span>${IS_APP ? 'A new version is out! Update the app to play online.' : 'A new version is out! Refresh the page to play online.'} Casual &amp; Free Kick still work.`;
    } else if (!S.online) {
      el.innerHTML = '<span class="dot off"></span>Offline — online modes unavailable. Casual & Free Kick still work.';
    } else {
      el.innerHTML = `<span class="dot${S.wsOk ? '' : ' off'}"></span>${S.wsOk ? `${S.onlineCount} kicker${S.onlineCount === 1 ? '' : 's'} online` : 'Connecting…'}`;
    }
  }

  function renderMenu() {
    const chip = $('#menuProfile');
    if (S.player) {
      const p = S.player;
      chip.innerHTML = `👤 ${esc(p.name)}${stars(p.prestige)}${p.career && p.career.pro ? ' <span class="pro-badge">PRO</span>' : ''} · Lv ${p.level} · <span class="coins">🪙 ${fmt(p.coins)}</span>`;
    } else if (S.online) {
      const o = S.offline;
      chip.innerHTML = `👤 Create your kicker name · <span class="muted">offline Lv ${C.levelFromXp(o.xp)}</span>`;
    } else {
      const o = S.offline;
      chip.innerHTML = `📴 Offline profile${o.career && o.career.pro ? ' <span class="pro-badge">PRO</span>' : ''} · Lv ${C.levelFromXp(o.xp)} · <span class="coins">🪙 ${fmt(o.coins)}</span>`;
    }
    $$('[data-action="ranked"], [data-action="rooms"]').forEach((b) => { b.disabled = !S.online; });
    renderChallengeBadge();
    renderStatus();
  }

  function requirePlayer(fn) {
    if (!S.online) { toast('You need to be online for that', 'error'); return; }
    if (S.player) { fn(); return; }
    S.pendingAfterName = fn;
    $('#nameError').textContent = '';
    show('name');
    setTimeout(() => $('#nameInput').focus(), 50);
  }

  // -------------------------------------------------------------------------
  // Rounds
  // -------------------------------------------------------------------------
  async function postKick(roundId, index, frame) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api('/api/round/kick', { roundId, index, frame });
      } catch (e) {
        if (e.status || attempt >= 3) throw e;
        toast('Connection wobble — retrying…', 'small');
        await sleep(900 * (attempt + 1));
      }
    }
  }

  async function startRanked(challenge) {
    try {
      const r = await api('/api/round/start', challenge ? { challengeOf: challenge.id } : {});
      announceBoost(r.boost);
      beginOnlineRound({
        kind: challenge ? 'challenge' : 'ranked', roundId: r.roundId, baseSeed: r.baseSeed, upgrades: r.upgrades,
        beat: challenge ? challenge.score : null, challenge,
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /** A Piñata boost kicked in for this round. */
  function announceBoost(b) {
    if (!b) return;
    const up = C.UPGRADES.find((u) => u.id === b.id);
    toast(`⚡ Piñata boost: +${b.levels} ${up ? `${up.icon} ${up.name}` : b.id} this round${b.roundsLeft ? ` (${b.roundsLeft} more after this)` : ''}`, 'good');
  }

  /** Describe a Piñata prize for the result card. */
  function pinataText(z) {
    if (!z) return '';
    if (z.type === 'coins') return `🪅 Piñata: +${fmt(z.coins)} 🪙`;
    if (z.type === 'upgrade') return `🪅 Piñata: free upgrade! ${z.icon} ${esc(z.name)} → Lv ${z.level}`;
    if (z.type === 'boost') return `🪅 Piñata: ⚡ +${z.levels} ${z.icon} ${esc(z.name)} for your next ${z.rounds} rounds`;
    if (z.type === 'item') return `🪅 Piñata: new ${z.slot}! ${esc(z.name)} (equip it in the Locker)`;
    return '';
  }

  /** Career match vs a boss. Online (server-verified) when signed in, otherwise on the offline profile. */
  async function startCareer(bossId) {
    const boss = EKCareer.bossById(bossId);
    if (!boss) return;
    if (careerOnline()) {
      try {
        const r = await api('/api/round/start', { career: boss.id });
        beginOnlineRound({ kind: 'career', roundId: r.roundId, baseSeed: r.baseSeed, upgrades: r.upgrades, boss });
      } catch (e) {
        toast(e.message, 'error');
      }
    } else {
      startOffline(P.KICKS_PER_ROUND, boss);
    }
  }

  function careerOnline() {
    return !!(S.online && S.player);
  }

  /** Attach the boss's kicks to the current round; they're revealed one by one after each of yours lands. */
  function attachBoss(cur, boss, baseSeed, upgrades) {
    cur.boss = boss;
    cur.cpuArgs = { baseSeed, upgrades: upgrades || {} };
    cur.cpu = { kicks: [] };
    cur.cpuTotal = 0;
  }

  /** Boss kicks are computed one at a time, as they're revealed, so phones never stall. */
  function bossKick(cur, i) {
    while (cur.cpu.kicks.length <= i) {
      const n = cur.cpu.kicks.length;
      cur.cpu.kicks.push(EKCareer.cpuKick(cur.cpuArgs.baseSeed, cur.boss, n, cur.cpuArgs.upgrades, cur.cpu.kicks));
    }
    return cur.cpu.kicks[i];
  }

  hud.onResult = (r) => {
    renderRoomPanel();
    const cur = S.current;
    if (!cur || !cur.cpu || r.index == null) return null;
    const ck = bossKick(cur, r.index);
    cur.cpuTotal = cur.cpu.kicks.slice(0, r.index + 1).reduce((n, k) => n + k.points, 0);
    $('#hudVs').textContent = fmt(cur.cpuTotal);
    const lead = (game.total || 0) - cur.cpuTotal;
    const state = lead > 0 ? `You lead by ${fmt(lead)}` : lead < 0 ? `You trail by ${fmt(-lead)}` : 'All square';
    const pw = ck.power && P.POWER_BALLS[ck.power];
    return `${cur.boss.avatar} ${esc(cur.boss.name)}: ${pw ? `${pw.icon} ` : ''}${fmtM(ck.distance)} <small>(+${fmt(ck.points)})</small><br><b>${state}</b>`;
  };

  function beginOnlineRound(opts) {
    let chain = Promise.resolve();
    const cur = { kind: opts.kind, roundId: opts.roundId, kicks: [], milestones: [], challenges: [], challenge: opts.challenge || null };
    if (opts.boss) attachBoss(cur, opts.boss, opts.baseSeed, opts.upgrades);
    S.current = cur;
    hideScreens();
    hud.show('play', { beat: opts.beat, vs: opts.boss });
    game.startRound({
      baseSeed: opts.baseSeed,
      upgrades: opts.upgrades,
      equipped: S.player.equipped,
      kicks: P.KICKS_PER_ROUND,
      submit: (index, frame) => {
        const p = chain.then(() => postKick(opts.roundId, index, frame));
        chain = p.catch(() => {});
        return p.then((res) => {
          setPlayer(res.player);
          cur.kicks.push({ d: res.result.distance, p: res.points, t: res.result.target });
          cur.milestones.push(...(res.milestones || []));
          cur.challenges.push(...(res.challenges || []));
          return res;
        });
      },
      onEnd: (res) => {
        if (S.current !== cur) return;
        if (opts.kind === 'room') {
          hud.hide();
          game.attract(S.player.equipped);
          toast(`Your round: ${fmt(res.total)} pts`, 'good');
          if (res.summary) celebrate(res.summary);
          openRooms();
          return;
        }
        const summary = Object.assign({ kind: opts.kind, roundId: opts.roundId, kicks: cur.kicks }, res.summary || { score: res.total });
        summary.challenge = cur.challenge ? Object.assign({}, cur.challenge, summary.challenge) : null;
        summary.kickMilestones = cur.milestones;
        summary.challengesDone = cur.challenges;
        showEnd(summary);
      },
      onAbort: (msg) => {
        toast(msg, 'error');
        goMenu();
      },
    });
    renderRoomPanel();
  }

  function startOffline(kicks, boss) {
    const prof = S.offline;
    const endless = kicks === Infinity;
    const baseSeed = (Math.random() * 2 ** 32) >>> 0;
    const cur = { kind: boss ? 'career' : endless ? 'freekick' : 'casual', kicks: [], milestones: [], challenges: [], offline: true };
    if (boss) attachBoss(cur, boss, baseSeed, Object.assign({}, prof.upgrades));
    let upgrades = Object.assign({}, prof.upgrades, prof.prestige ? { prestige: prof.prestige | 0 } : {});
    if (!boss) {
      const used = C.useBoost(prof, upgrades);
      upgrades = used.upgrades;
      if (used.boost) { saveOffline(); announceBoost(used.boost); }
    }
    S.current = cur;
    let total = 0;
    hideScreens();
    hud.show('play', { vs: boss });
    game.startRound({
      baseSeed,
      upgrades,
      equipped: prof.equipped,
      kicks,
      submit: (index, frame, sim, pts) => {
        total += pts;
        // Coins and XP land after every kick, just like online.
        cur.streak = C.isGoodKick(sim) ? (cur.streak || 0) + 1 : 0;
        const earned = C.awardKick(prof, pts, { freeKick: endless, streak: cur.streak, golden: P.isGoldenBall(sim.seed) });
        cur.kicks.push({ d: sim.distance, p: pts, t: sim.target, c: earned.coins, lb: earned.levelBonus });
        const newBestKick = sim.distance > prof.bestKick;
        if (newBestKick) prof.bestKick = sim.distance;
        const pinata = sim.power === 'pinata' ? C.openPinata(prof, `offline:${baseSeed}:${index}`) : null;
        const milestones = C.checkMilestones(prof, { kick: sim });
        cur.milestones.push(...milestones);
        const challenges = CH.progress(prof, { kick: sim });
        cur.challenges.push(...challenges);
        saveOffline();
        return { points: pts, total, newBestKick, milestones, challenges, earned, pinata, done: false };
      },
      onEnd: () => {
        prof.coins += C.ROUND_COMPLETION_COINS;
        prof.roundsPlayed += 1;
        const daily = C.applyDaily(prof);
        const kickCoins = cur.kicks.reduce((n, k) => n + (k.c || 0), 0);
        const levelBonus = cur.kicks.reduce((n, k) => n + (k.lb || 0), 0);
        const levelAfter = C.levelFromXp(prof.xp);
        const levelBefore = C.levelFromXp(Math.max(0, prof.xp - total));
        const newBestRound = total > prof.bestRound;
        if (newBestRound) prof.bestRound = total;
        let career = null;
        if (boss) {
          bossKick(cur, P.KICKS_PER_ROUND - 1);
          const cpuTotal = cur.cpu.kicks.reduce((n, k) => n + k.points, 0);
          const applied = EKCareer.applyResult(prof.career, boss, total, cpuTotal);
          prof.career = applied.career;
          prof.coins += applied.outcome.reward;
          career = applied.outcome;
        }
        const crate = C.openCrate(prof, `offline:${baseSeed}:${prof.roundsPlayed}`);
        const roundChallenges = endless ? [] : CH.progress(prof, { round: { score: total, careerWon: !!(career && career.won) } });
        cur.challenges.push(...roundChallenges);
        const roundMilestones = C.checkMilestones(prof, { roundScore: total });
        saveOffline();
        showEnd({
          kind: cur.kind, offline: true, kicks: cur.kicks, score: total, coins: kickCoins + C.ROUND_COMPLETION_COINS, xp: total,
          newBestRound, levelBefore, levelAfter, levelBonus, career, daily, crate, milestones: roundMilestones, kickMilestones: cur.milestones,
          challengesDone: cur.challenges,
          coinBreakdown: {
            points: kickCoins, completion: C.ROUND_COMPLETION_COINS, daily: daily.bonus, crate: crate.coins, levelBonus,
            career: career ? career.reward : 0, milestones: roundMilestones.reduce((n, m) => n + m.reward, 0),
          },
          nextUnlock: C.nextUnlocks(levelAfter),
        });
      },
      onAbort: (msg) => { toast(msg, 'error'); goMenu(); },
    });
  }

  function celebrate(summary) {
    if (summary.career && summary.career.wentPro) {
      sfx.levelUp();
      toast('⭐ You went PRO! Mastery Pro Ball unlocked!', 'good');
    } else if (summary.levelAfter > summary.levelBefore) {
      sfx.levelUp();
      toast(`Level up! You're now level ${summary.levelAfter}`, 'good');
    } else {
      sfx.coin();
    }
  }

  function coinBreakdownHtml(s) {
    const b = s.coinBreakdown;
    if (!b) return '';
    const kickMs = (s.kickMilestones || []).reduce((n, m) => n + m.reward, 0);
    const rows = [
      [`Kick coins (1 per ${C.POINTS_PER_COIN} pts, with combos, golden balls & bonuses)`, b.points],
      [s.crate ? `${s.crate.icon} ${s.crate.name}` : 'Kick Crate', b.crate || 0],
      ['Round completion bonus', b.completion],
      [`Daily bonus${s.daily && s.daily.streak > 1 ? ` (🔥 ${s.daily.streak}-day streak)` : ''}`, b.daily || 0],
      [`Level-up bonus`, b.levelBonus],
      ['Career first-win bounty', b.career],
      ['Milestones', b.milestones + kickMs],
      ['Daily & weekly challenges', (s.challengesDone || []).reduce((n, c) => n + c.reward, 0)],
    ].filter(([, v]) => v > 0);
    const total = rows.reduce((n, [, v]) => n + v, 0);
    return `<details class="coin-breakdown" open><summary>🪙 +${fmt(total)} coins — how you earned them</summary>
      <table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="val">+${fmt(v)}</td></tr>`).join('')}</table></details>`;
  }

  function showEnd(s) {
    hud.hide();
    game.attract(activeProfileFor(s).equipped);
    celebrate(s);
    const online = !s.offline && (s.kind === 'ranked' || s.kind === 'challenge' || s.kind === 'career');
    const kicks = (s.kicks || []).map((k, i) => `<div class="${k.t ? 'tgt' : ''}" title="${k.t ? esc(k.t.name || k.t) : ''}">#${i + 1}<b>${fmt(k.d)}m</b>+${fmt(k.p)}</div>`).join('');
    const best = (s.kicks || []).reduce((m, k) => Math.max(m, k.d), 0);
    let banners = '';
    let title = s.kind === 'casual' ? 'Casual round complete' : s.kind === 'challenge' ? 'Challenge complete' : 'Round complete';
    const c = s.career;
    if (c) {
      title = c.won ? `${c.boss.avatar} You beat ${c.boss.name}!` : `${c.boss.avatar} ${c.boss.name} wins this time`;
      const diff = c.skillAfter - c.skillBefore;
      banners += `<div class="versus ${c.won ? 'won' : 'lost'}">
          <div><span>You</span><b>${fmt(c.playerScore)}</b></div><div class="vs-mid">VS</div>
          <div><span>${esc(c.boss.name)}</span><b>${fmt(c.cpuTotal)}</b></div></div>
        <div class="banner ${diff >= 0 ? 'green' : 'blue'}">Skill Level ${fmt(c.skillBefore)} → <b>${fmt(c.skillAfter)}</b> (${diff >= 0 ? '+' : ''}${diff})</div>`;
      if (c.wentPro) banners += '<div class="banner pro">⭐ YOU WENT PRO! The <b>Mastery Pro Ball</b> is now in your locker.</div>';
      if (c.firstWin && c.nextBoss) banners += `<div class="banner">🔓 New challenger: ${c.nextBoss.avatar} ${esc(c.nextBoss.name)}</div>`;
    }
    if (s.challenge) {
      banners += s.challenge.won
        ? `<div class="banner green">🏆 You beat ${esc(s.challenge.name)}'s ${fmt(s.challenge.score)}!</div>`
        : `<div class="banner blue">So close! ${esc(s.challenge.name)} scored ${fmt(s.challenge.score)}.</div>`;
    }
    if (s.newBestRound) banners += '<div class="banner">★ New personal best round!</div>';
    if (s.levelAfter > s.levelBefore) banners += `<div class="banner green">⬆️ Level ${s.levelAfter}!</div>`;
    if (s.crate) {
      banners += `<div class="crate crate-${s.crate.id}"><span class="crate-icon">${s.crate.icon}</span>
        <div><b>${esc(s.crate.name)}!</b><span>+${fmt(s.crate.coins)} 🪙</span></div></div>`;
      if (s.crate.id === 'epic' || s.crate.id === 'legendary') setTimeout(() => sfx.levelUp(), 600);
    }
    const chDone = s.challengesDone || [];
    if (chDone.length) banners += `<div class="banner green">✅ ${chDone.map((c) => `${esc(c.text)} <small>+${fmt(c.reward)}</small>`).join(' · ')}</div>`;
    const ms = (s.kickMilestones || []).concat(s.milestones || []);
    if (ms.length) banners += `<div class="banner milestone">🏅 ${ms.map((m) => `${esc(m.name)} <small>+${fmt(m.reward)}</small>`).join(' · ')}</div>`;
    const rank = online && s.ranks && s.ranks.round ? `<div class="reward rank"><b>#${s.ranks.round}</b>All-time rank</div>` : '';
    if (online && S.player && !S.player.hasPassword) {
      banners += '<div class="banner blue">🔒 Protect your progress: <a href="#" data-end="profile">set a password</a> so you can log in on any device.</div>';
    }
    if (s.daily && s.daily.bonus) banners += `<div class="banner">🔥 Daily bonus +${fmt(s.daily.bonus)} 🪙 — ${s.daily.streak}-day streak! Come back tomorrow for more.</div>`;
    const nu = s.nextUnlock;
    const next = nu ? `<div class="next-unlock">🔓 <b>Next unlock at level ${nu.level}:</b> ${nu.items.map(esc).join(', ')}</div>` : '';
    $('#endBody').innerHTML = `
      <div class="end-title">${esc(title)}</div>
      <div class="end-score">${fmt(s.score)}</div>
      <div class="end-sub">points · longest kick ${fmtM(best)}</div>
      ${banners}
      <div class="kick-list">${kicks}</div>
      <div class="rewards">
        <div class="reward"><b>+${fmt(s.coins)}</b>round coins</div>
        <div class="reward xp"><b>+${fmt(s.xp)}</b>XP</div>
        ${rank}
      </div>
      ${coinBreakdownHtml(s)}
      ${next}
      <div class="actions">
        <button class="btn primary" data-end="again">${c ? (c.won && c.nextBoss ? `⚔️ Next: ${esc(c.nextBoss.name)}` : '🔁 Rematch') : '⚽ Play again'}</button>
        ${c ? '<button class="btn gold" data-end="career">🏆 Career</button>' : ''}
        ${online && s.roundId && !c ? '<button class="btn green" data-end="challenge">⚔️ Challenge a friend</button>' : ''}
        <button class="btn" data-end="shop">🛒 Shop</button>
        ${online && !c ? '<button class="btn" data-end="leaderboard">🏆 Leaderboard</button>' : ''}
        <button class="btn" data-end="menu">Menu</button>
      </div>`;
    $('#endBody').onclick = (e) => {
      const b = e.target.closest('[data-end]');
      if (!b) return;
      sfx.click();
      const a = b.dataset.end;
      if (a === 'again') {
        if (c) startCareer(c.won && c.nextBoss ? c.nextBoss.id : c.boss.id);
        else if (s.kind === 'casual') startOffline(P.KICKS_PER_ROUND);
        else if (s.kind === 'challenge' && s.challenge) startRanked(s.challenge.id ? s.challenge : null);
        else startRanked();
      } else if (a === 'career') openCareer();
      else if (a === 'profile') { e.preventDefault(); renderProfile(); show('profile'); }
      else if (a === 'challenge') shareChallenge(s.roundId, s.score);
      else if (a === 'shop') openShop(s.offline ? 'offline' : 'online');
      else if (a === 'leaderboard') openLeaderboard();
      else goMenu();
    };
    show('end');
  }

  function activeProfileFor(s) {
    return s.offline ? S.offline : S.player || S.offline;
  }

  async function shareChallenge(roundId, score) {
    const url = `${location.origin}/?c=${encodeURIComponent(roundId)}`;
    const text = `I scored ${fmt(score)} in Eggers Kick Off. Same 10 kicks — can you beat me?`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Eggers Kick Off challenge', text, url }); return; } catch (e) { /* fall back to copy */ }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('Challenge link copied! Send it to a friend.', 'good');
    } catch (e) {
      modal(`<h2>Challenge link</h2><p class="muted">Copy this and send it to a friend:</p><code class="token">${esc(url)}</code>
        <div class="actions"><button class="btn primary" data-modal="close">Done</button></div>`);
    }
  }

  function quitPrompt() {
    if (game.mode === 'replay') { game.stop(); goMenu(); return; }
    const kind = S.current && S.current.kind;
    const warn = kind === 'career' ? 'Leaving forfeits nothing, but this match won’t count for your Skill Level.'
      : kind === 'ranked' || kind === 'challenge' ? 'An unfinished ranked round won’t count towards the leaderboard (kicks so far still count for your longest kick).'
      : kind === 'room' ? 'You’ll stay on the room board with the kicks you’ve taken so far.'
        : kind === 'freekick' ? 'Coins from your free kicks are already saved.'
          : 'This casual round won’t be saved.';
    modal(`<h2>Leave this round?</h2><p class="muted">${warn}</p>
      <div class="actions"><button class="btn danger" data-modal="leave">Leave</button><button class="btn primary" data-modal="close">Keep kicking</button></div>`,
    (a) => {
      if (a === 'leave') {
        if (kind === 'freekick' && S.current.kicks.length) {
          const best = S.current.kicks.reduce((m, k) => Math.max(m, k.d), 0);
          toast(`Free kick session: ${S.current.kicks.length} kicks, best ${fmtM(best)}`, 'good');
        }
        game.stop();
        goMenu();
      } else {
        hideScreens();
      }
    });
  }

  function modal(html, onAction) {
    $('#modalBody').innerHTML = html;
    $('#modalBody').onclick = (e) => {
      const b = e.target.closest('[data-modal]');
      if (!b) return;
      sfx.click();
      const a = b.dataset.modal;
      if (onAction) onAction(a);
      else if (a === 'close') goBackFromModal();
    };
    if (S.screen !== 'modal') S.modalReturn = S.screen; // a modal opened from a modal returns to the screen underneath
    show('modal');
  }
  function goBackFromModal() {
    if (game.mode === 'play' || game.mode === 'replay') hideScreens();
    else if (S.modalReturn && S.modalReturn !== 'modal') show(S.modalReturn);
    else goMenu();
  }

  // -------------------------------------------------------------------------
  // Coins guide, Career, Patch notes
  // -------------------------------------------------------------------------
  function coinGuideHtml() {
    return `<ul class="howto coin-guide">
      <li><b>Every kick:</b> 1 coin for every ${C.POINTS_PER_COIN} points, paid as soon as the ball stops (Free Kick: 1 per ${C.FREE_KICK_POINTS_PER_COIN}).</li>
      <li><b>🔥 Combos:</b> GREAT or PERFECT kicks in a row multiply your kick coins: ×1.25, ×1.5… up to ×${C.COMBO_MAX}.</li>
      <li><b>🌟 Golden Balls:</b> about 1 ball in 8 glows gold. Kick it for ×${C.GOLDEN_MULT} coins.</li>
      <li><b>🎖️ Veteran bonus:</b> +1% coins for every level above ${C.VETERAN_FROM_LEVEL} (up to +${Math.round(C.VETERAN_MAX * 100)}%).</li>
      <li><b>🎁 Kick Crates:</b> every finished round opens a crate: Common, Rare, Epic or Legendary, worth more as you level up.</li>
      <li><b>Finish a round:</b> +${C.ROUND_COMPLETION_COINS} completion bonus.</li>
      <li><b>Daily streak:</b> your first round each day pays ${C.DAILY_BONUS_PER_DAY} × your streak (up to ${fmt(C.DAILY_BONUS_PER_DAY * C.DAILY_BONUS_MAX_DAYS)} on day ${C.DAILY_BONUS_MAX_DAYS}+).</li>
      <li><b>Level up:</b> bonus coins every level (${fmt(C.levelUpCoins(2))} at level 2, rising by 25 each level).</li>
      <li><b>Milestones:</b> one-time rewards from ${fmt(Math.min(...C.MILESTONES.map((m) => m.reward)))} to ${fmt(Math.max(...C.MILESTONES.map((m) => m.reward)))} coins (see Locker → Milestones).</li>
      <li><b>Prestige ⭐:</b> every prestige permanently adds +${Math.round(C.PRESTIGE_COIN_BONUS * 100)}% to all kick coins.</li>
      <li><b>Career:</b> the first win against each boss pays a bounty (up to ${fmt(Math.max(...EKCareer.BOSSES.map((b) => b.reward)))} coins).</li>
    </ul>`;
  }

  function careerProfile() {
    return careerOnline() ? S.player : S.offline;
  }

  function openCareer() {
    renderCareer();
    show('career');
  }

  function skillGraph(history) {
    const pts = history.length > 1 ? history : [0].concat(history);
    const w = 280, h = 70, max = Math.max(EKCareer.PRO_SKILL * 1.2, ...pts);
    const xy = pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
    const proY = (h - (EKCareer.PRO_SKILL / max) * h).toFixed(1);
    return `<svg class="skill-graph" viewBox="-4 -4 ${w + 8} ${h + 8}" role="img" aria-label="Skill level history">
      <line x1="0" x2="${w}" y1="${proY}" y2="${proY}" class="pro-line"/>
      <text x="${w}" y="${Number(proY) - 3}" text-anchor="end" class="pro-label">PRO</text>
      <polyline points="${xy}" class="skill-line"/>
    </svg>`;
  }

  function renderCareer() {
    const prof = careerProfile();
    const car = EKCareer.normalize(prof.career);
    const pct = Math.min(100, (car.skill / EKCareer.PRO_SKILL) * 100);
    const mode = careerOnline() ? `🌐 ${esc(S.player.name)} — server-verified` : '📴 Offline profile';
    let html = `
      <div class="career-head">
        <div class="skill-box">
          <span class="muted">Skill Level</span>
          <div class="skill-num">${fmt(car.skill)}${car.pro ? ' <span class="pro-badge">PRO</span>' : ''}</div>
          <div class="pro-bar"><div style="width:${pct}%"></div><span>PRO 1,000</span></div>
          <div class="muted small">${mode} · ${car.wins}W–${car.matches - car.wins}L</div>
        </div>
        <div class="graph-box">${skillGraph(car.history)}</div>
        <div class="mastery ${car.pro ? 'earned' : ''}">
          <canvas id="masteryPreview" width="72" height="72"></canvas>
          <div><b>Mastery Pro Ball</b><br><span class="muted small">${car.pro ? 'Earned! Equip it in the Locker.' : 'Reach 1,000 skill to earn it.'}</span></div>
        </div>
      </div>
      <p class="muted">Every match is 10 kicks on the <b>same balls, wind and field</b> as your opponent. Beat a boss to unlock the next. Wins raise your Skill Level, losses lower it.</p>`;
    for (const tier of EKCareer.TIERS) {
      const bosses = EKCareer.BOSSES.filter((b) => b.tier === tier.id);
      html += `<h3 style="color:${tier.color}">${esc(tier.name)}</h3><div class="boss-grid">`;
      html += bosses.map((b) => {
        const beaten = car.beaten.includes(b.id);
        const open = EKCareer.isUnlocked(car, b.id);
        const status = beaten ? '<span class="tag won">✓ Beaten</span>' : open ? '<span class="tag next">Next challenger</span>' : '<span class="tag">🔒 Locked</span>';
        return `<div class="boss ${open ? '' : 'locked'} ${beaten ? 'beaten' : ''}">
          <div class="boss-avatar">${open ? b.avatar : '❔'}</div>
          <div class="boss-info"><b>${open ? esc(b.name) : '???'}</b>
            <span class="muted small">Rating ${fmt(b.rating)} · Gear Lv ${EKCareer.bossGearLevel(b, prof.upgrades)} · ${beaten ? 'bounty claimed' : `bounty 🪙 ${fmt(b.reward)}`}</span>
            ${open ? `<i class="taunt">“${esc(b.taunt)}”</i>` : ''}${status}</div>
          ${open ? `<button class="btn ${beaten ? '' : 'primary'}" data-boss="${b.id}">${beaten ? 'Rematch' : 'Challenge'}</button>` : ''}
        </div>`;
      }).join('');
      html += '</div>';
    }
    $('#careerBody').innerHTML = html;
    const cv = $('#masteryPreview');
    if (cv) {
      const r = new EK.Renderer(cv);
      r.canvas.width = 144; r.canvas.height = 144; r.W = 72; r.H = 72; r.dpr = 2; r.groundY = 999;
      r.setEquipped({ ball: 'mastery' });
      r.camX = 0; r.scale = 260; r.anchor = 0.5; r.time = performance.now() / 1000;
      r.ctx.setTransform(2, 0, 0, 2, 0, 0);
      r.ctx.globalAlpha = car.pro ? 1 : 0.35;
      r.drawBall(0, (999 - 36) / 260, 0.3, r.time);
      r.ctx.globalAlpha = 1;
    }
  }

  // ---- Daily & weekly challenges -------------------------------------------
  function challengeProfile() {
    return S.player || S.offline;
  }

  function untilText(ms) {
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
  }

  async function openChallenges() {
    if (S.player) await loadMe(); // the server rolls new challenges when a period starts
    else { CH.roll(S.offline); saveOffline(); }
    renderChallenges();
    show('challenges');
  }

  function challengeCard(c) {
    const pct = Math.min(100, (c.progress / c.goal) * 100);
    const prog = c.single && c.progress && !c.done ? `best ${fmt(c.progress)}` : `${fmt(c.progress)} / ${fmt(c.goal)}`;
    return `<div class="item ch ${c.done ? 'equipped' : ''}"><div class="top"><span class="icon">${c.done ? '✅' : c.icon}</span>
      <div><div class="name">${esc(c.text)}</div><div class="desc">${c.done ? 'Complete!' : prog}</div></div></div>
      <div class="upbar"><div style="width:${pct}%"></div></div>
      <div class="ms-reward">${c.done ? `✓ +${fmt(c.reward)} 🪙 earned` : `Reward 🪙 ${fmt(c.reward)}`}</div></div>`;
  }

  function renderChallenges() {
    const prof = challengeProfile();
    CH.roll(prof);
    const ch = prof.challenges;
    const ends = CH.periodEnds(Date.now());
    const now = Date.now();
    const who = S.player ? `🌐 ${esc(S.player.name)}` : '📴 Offline profile';
    const allDaily = ch.daily.every((c) => c.done);
    $('#challengesBody').innerHTML = `
      <p class="muted">${who} · Everyone gets the same challenges, with goals set to <b>your</b> bests. Rewards are paid the moment you complete one.</p>
      <h3>☀️ Daily <span class="muted small">— resets in ${untilText(ends.dayEnd - now)}</span></h3>
      <div class="grid">${ch.daily.map(challengeCard).join('')}</div>
      <div class="banner ${allDaily ? 'green' : 'blue'}">${allDaily ? '🎉 All daily challenges done — bonus paid!' : `Finish all 3 dailies for a bonus of 🪙 ${fmt(CH.rewardFor(prof, false) * 2)}`}</div>
      <h3>📅 Weekly <span class="muted small">— resets in ${untilText(ends.weekEnd - now)}</span></h3>
      <div class="grid">${ch.weekly.map(challengeCard).join('')}</div>
      <div class="actions"><button class="btn primary" data-action="${S.player ? 'ranked' : 'casual'}">⚽ Play a round</button></div>`;
  }

  function renderChallengeBadge() {
    const prof = challengeProfile();
    CH.roll(prof);
    const ch = prof.challenges;
    const left = ch.daily.concat(ch.weekly).filter((c) => !c.done).length;
    $('#chBadge').textContent = left;
    $('#chBadge').classList.toggle('hidden', !left);
    $('#chSub').textContent = left ? `${left} to complete · rewards up to 🪙 ${fmt(CH.rewardFor(prof, true))}` : 'All done — new ones tomorrow!';
  }

  const PATCH_SEEN_KEY = 'ek_patch_seen';
  function latestPatch() {
    return (window.EK_PATCH_NOTES || [])[0];
  }
  function renderPatchBadge() {
    const latest = latestPatch();
    $('#patchBadge').classList.toggle('hidden', !latest || local.get(PATCH_SEEN_KEY, null) === latest.version);
  }
  function openPatchNotes() {
    const notes = window.EK_PATCH_NOTES || [];
    const html = notes.map((n, i) => `
      <div class="patch ${i ? 'old' : ''}">
        <div class="patch-head"><span class="patch-ver">v${esc(n.version)}</span><span class="muted">${esc(n.date)}</span></div>
        <h3>${esc(n.title)}</h3>
        ${n.sections.map((sec) => `<h4>${esc(sec.heading)}</h4><ul>${sec.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>`).join('')}
      </div>`).join('');
    modal(`<h2>📰 Patch notes</h2><div class="patch-notes">${html}</div>
      <div class="actions"><button class="btn primary" data-modal="close">Let's kick!</button></div>`);
    if (notes[0]) local.set(PATCH_SEEN_KEY, notes[0].version);
    renderPatchBadge();
  }

  // -------------------------------------------------------------------------
  // Shop
  // -------------------------------------------------------------------------
  function openShop(which) {
    S.shopProfile = which || (S.player ? 'online' : 'offline');
    if (S.shopProfile === 'online' && !S.player) S.shopProfile = 'offline';
    renderShop();
    show('shop');
  }

  function shopProfileObj() {
    return S.shopProfile === 'online' ? S.player : S.offline;
  }

  function renderShop() {
    const prof = shopProfileObj();
    $('#shopProfileTabs').innerHTML = S.player
      ? `<button data-prof="online" class="${S.shopProfile === 'online' ? 'active' : ''}">🌐 ${esc(S.player.name)}</button>
         <button data-prof="offline" class="${S.shopProfile === 'offline' ? 'active' : ''}">📴 Offline profile</button>`
      : `<span class="muted">📴 Offline profile${S.online ? ' — create a kicker name to save online progress' : ''}</span>`;
    const level = C.levelFromXp(prof.xp);
    const lo = C.xpForLevel(level), hi = C.xpForLevel(level + 1);
    const pct = Math.min(100, ((prof.xp - lo) / (hi - lo)) * 100);
    const nu = C.nextUnlocks(level);
    $('#shopHead').innerHTML = `
      <div class="coins-big">🪙 ${fmt(prof.coins)}</div>
      <div class="level-box"><b>Level ${level}</b> <span class="muted">· ${fmt(prof.xp - lo)} / ${fmt(hi - lo)} XP to level ${level + 1}</span>
        <div class="xpbar"><div style="width:${pct}%"></div></div>
        ${nu ? `<div class="muted small">🔓 Level ${nu.level} unlocks: ${nu.items.map(esc).join(', ')}</div>` : ''}</div>
      <details class="coin-help"><summary>🪙 How do I earn coins?</summary>${coinGuideHtml()}</details>`;
    $$('#shopTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.shopTab));
    const grid = $('#shopGrid');
    if (S.shopTab === 'upgrades') {
      grid.innerHTML = C.UPGRADES.map((u) => {
        const lv = (prof.upgrades && prof.upgrades[u.id]) | 0;
        const pips = `<div class="upbar"><div style="width:${(lv / C.MAX_UPGRADE) * 100}%"></div>${[10, 20, 30, 40].map((m) => `<i style="left:${(m / C.MAX_UPGRADE) * 100}%"></i>`).join('')}</div>`;
        let btn;
        if (lv >= C.MAX_UPGRADE) btn = '<button disabled>MAXED</button>';
        else if (level < C.UPGRADE_LEVEL_REQ[lv]) btn = `<button disabled>🔒 Level ${C.UPGRADE_LEVEL_REQ[lv]}</button>`;
        else {
          const cost = C.upgradeCost(u.id, lv);
          btn = `<button data-buy="upgrade:${u.id}" ${prof.coins < cost ? 'disabled' : ''}>Upgrade · 🪙 ${fmt(cost)}</button>`;
        }
        return `<div class="item"><div class="top"><span class="icon">${u.icon}</span><div><div class="name">${esc(u.name)}</div><div class="desc">${esc(u.desc)}</div></div></div>
          ${pips}<div class="muted small">Level ${lv} / ${C.MAX_UPGRADE}</div>${btn}</div>`;
      }).join('');
    } else if (S.shopTab === 'prestige') {
      grid.innerHTML = prestigeHtml(prof);
    } else if (S.shopTab === 'milestones') {
      const have = new Set(prof.milestones || []);
      const done = C.MILESTONES.filter((m) => have.has(m.id)).length;
      grid.innerHTML = `<div class="ms-summary">🏅 ${done} / ${C.MILESTONES.length} milestones complete</div>` + C.MILESTONES.map((m) => `
        <div class="item ms ${have.has(m.id) ? 'equipped' : ''}"><div class="top"><span class="icon">${have.has(m.id) ? '🏅' : '🔒'}</span>
          <div><div class="name">${m.secret && !have.has(m.id) ? '❓ Secret milestone' : esc(m.name)}</div><div class="desc">${esc(m.secret && !have.has(m.id) ? m.secret : m.desc)}</div></div></div>
          <div class="ms-reward">${have.has(m.id) ? '✓ Claimed' : `Reward 🪙 ${fmt(m.reward)}`}</div></div>`).join('');
    } else {
      const list = C.SLOTS[S.shopTab];
      const eq = Object.assign({}, C.DEFAULT_EQUIPPED, prof.equipped);
      // Limited-time seasonal gear comes first while its season is on.
      const seasonal = (it) => (it.season && C.seasonActive(it.season) ? 0 : 1);
      grid.innerHTML = list.slice()
        .filter((it) => !it.season || C.seasonActive(it.season) || C.isOwned(prof, S.shopTab, it.id))
        .sort((a, b) => seasonal(a) - seasonal(b) || a.level - b.level).map((it) => {
        const key = `${S.shopTab}:${it.id}`;
        const owned = C.isOwned(prof, S.shopTab, it.id);
        const isEq = eq[S.shopTab] === it.id;
        let btn;
        if (isEq) btn = '<button class="owned" disabled>✓ Equipped</button>';
        else if (owned) btn = `<button class="owned" data-equip="${S.shopTab}:${it.id}">Equip</button>`;
        else if (it.career) btn = '<button disabled>🏆 Go PRO in Career</button>';
        else if (it.prestige) btn = `<button disabled>⭐ Prestige ${it.prestige}</button>`;
        else if (level < it.level) btn = `<button disabled>🔒 Level ${it.level}</button>`;
        else btn = `<button data-buy="${key}" ${prof.coins < it.cost ? 'disabled' : ''}>Buy · 🪙 ${fmt(it.cost)}</button>`;
        const season = it.season && C.SEASONS[it.season];
        const tag = season ? `<span class="season-tag" title="Limited edition: buy it during ${esc(season.name)}, keep it forever">${season.icon} Limited</span>` : '';
        const desc = it.desc ? `<div class="desc">${esc(it.desc)}</div>` : '';
        return `<div class="item ${isEq ? 'equipped' : ''} ${season ? 'seasonal' : ''}"><div class="top">${itemIcon(S.shopTab, it)}<div><div class="name">${esc(it.name)}${tag}</div>${desc}</div></div>${btn}</div>`;
      }).join('');
      if (S.shopTab === 'outfit' && eq.character === 'henry') {
        grid.insertAdjacentHTML('afterbegin', '<div class="season-banner henry-note">🪿 You\'re playing as <b>Henry</b>. Outfits are worn by Jason: switch back in <b>Characters</b> to show them off. Your ball and trail work for both.</div>');
      }
      const live = Object.values(C.SEASONS).find((x) => C.seasonActive(x.id));
      if (live && S.shopTab !== 'upgrades') {
        grid.insertAdjacentHTML('afterbegin', `<div class="season-banner">${live.icon} <b>${esc(live.name)}</b> is here! Limited gear is in the shop until ${live.to[1]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][live.to[0] - 1]}. Whatever you buy is yours to keep.</div>`);
      }
    }
  }

  /** "🥋 Black Gi · 🎃 Jack-o'-Ball · 🦇 Bat Swarm": what a kicker is wearing, for the leaderboard. */
  function gearLine(eq) {
    if (!eq) return '';
    const parts = [];
    const henry = eq.character === 'henry';
    if (henry) parts.push('🪿 Henry');
    for (const slot of ['outfit', 'ball', 'trail']) {
      if (slot === 'outfit' && henry) continue; // Henry doesn't wear Jason's outfits
      const it = (C.SLOTS[slot] || []).find((x) => x.id === eq[slot]);
      if (!it || (slot === 'trail' && it.id === 'none')) continue;
      const icon = itemIcon(slot, it).replace(/<[^>]+>/g, '');
      parts.push(`${icon} ${esc(it.name.replace(/\s*[\u{1F300}-\u{1FAFF}]$/u, ''))}`);
    }
    return parts.length ? `<span class="lb-gear" title="${parts.join(' · ')}">${parts.join(' · ')}</span>` : '';
  }

  function itemIcon(slot, it) {
    if (slot === 'character') return `<span class="icon" style="background:${it.id === 'henry' ? '#fff3e0' : '#1c1c1e'}">${it.id === 'henry' ? '🪿' : '🥋'}</span>`;
    if (slot === 'outfit') {
      const special = { astro: '🧑‍🚀', suit: '👔', pumpkintee: '🎃', skeleton: '💀', vampire: '🧛', wizard: '🧙', hockey: '🏒', cultist: '🕯️', pirate: '🏴‍☠️' };
      return `<span class="icon" style="background:${it.shirt}">${special[it.id] || (it.pattern === 'gi' ? '🥋' : '👕')}</span>`;
    }
    if (slot === 'ball') {
      const icons = { egg: '🥚', fire: '🔥', beach: '🏖️', henry: '🪿', disco: '🪩', planet: '🪐', moon: '🌕', mastery: '🏆', galaxy: '🌌', blackhole: '🕳️', star: '⭐', diamond: '💎', jackoball: '🎃', eyeball: '👁️', brew: '🧪', crystal: '🔮', orb: '🛸', medusa: '🐍' };
      return `<span class="icon" style="background:${it.base}">${icons[it.style] || '⚽'}</span>`;
    }
    const icons = { none: '➖', dots: '⋯', sparkle: '✨', rainbow: '🌈', flame: '🔥', feathers: '🪶', stars: '🌠', confetti: '🎉', comet: '☄️', cosmic: '🌠', aura: '💫', supernova: '💥', bats: '🦇', ghosts: '👻' };
    return `<span class="icon">${icons[it.id] || '✨'}</span>`;
  }

  function prestigeHtml(prof) {
    const rank = prof.prestige | 0;
    const have = C.totalUpgradeLevels(prof);
    const need = C.prestigeRequirement(rank);
    const ready = have >= need && rank < C.MAX_PRESTIGE;
    const pct = Math.min(100, (have / need) * 100);
    const nextRewards = [];
    for (let r = rank + 1; r <= rank + 10 && nextRewards.length < 3; r++) {
      const items = C.prestigeRewardsAt(r);
      if (items.length) nextRewards.push(`⭐${r}: ${items.map(esc).join(', ')}`);
    }
    const bonus = (r) => `+${Math.round(r * C.PRESTIGE_COIN_BONUS * 100)}% coins · +${Math.round(r * C.PRESTIGE_POWER_BONUS * 100)}% kick power`;
    return `<div class="prestige-card">
      <div class="prestige-rank">${rank ? `⭐${rank}` : 'No prestige yet'}</div>
      <div class="muted">${rank ? `Your permanent bonus: <b>${bonus(rank)}</b>` : 'Prestige to earn permanent bonuses.'}</div>
      <h3>Next: ⭐${rank + 1}</h3>
      <div class="pro-bar"><div style="width:${pct}%"></div><span>${fmt(have)} / ${fmt(need)} upgrade levels</span></div>
      <ul class="howto">
        <li><b>You gain:</b> ${bonus(rank + 1)} (permanent), ⭐${rank + 1} next to your name, and a ${fmt(C.PRESTIGE_START_COINS * (rank + 1))}-coin starter pack.</li>
        <li><b>Resets:</b> all upgrades back to level 0, and your coins.</li>
        <li><b>You keep:</b> your level, outfits, balls & trails, milestones, Career progress and leaderboard records.</li>
        ${nextRewards.length ? `<li><b>Prestige gear:</b> ${nextRewards.join(' · ')}</li>` : ''}
      </ul>
      <button class="btn ${ready ? 'gold' : ''}" data-prestige ${ready ? '' : 'disabled'}>${ready ? `⭐ Prestige to ⭐${rank + 1}` : `Reach ${fmt(need)} total upgrade levels`}</button>
    </div>`;
  }

  function confirmPrestige() {
    const prof = shopProfileObj();
    const next = (prof.prestige | 0) + 1;
    modal(`<h2>⭐ Prestige to ⭐${next}?</h2>
      <p>Your <b>upgrades and coins reset to zero</b>. In return you get a permanent <b>+${Math.round(next * C.PRESTIGE_COIN_BONUS * 100)}% coins</b>
      and <b>+${Math.round(next * C.PRESTIGE_POWER_BONUS * 100)}% kick power</b>, plus ${fmt(C.PRESTIGE_START_COINS * next)} coins to start the climb.</p>
      <p class="muted">You keep your level, cosmetics, milestones, Career and records. This can't be undone.</p>
      <div class="actions"><button class="btn gold" data-modal="yes">⭐ Prestige</button><button class="btn" data-modal="no">Not yet</button></div>`,
    async (a) => {
      if (a !== 'yes') { show('shop'); return; }
      try {
        let milestones = [];
        if (S.shopProfile === 'online') {
          const res = await api('/api/prestige', {});
          setPlayer(res.player);
          milestones = res.milestones || [];
        } else {
          const err = C.applyPrestige(S.offline);
          if (err) throw new Error(err);
          milestones = C.checkMilestones(S.offline, {});
          saveOffline();
        }
        sfx.levelUp();
        toast(`⭐ Prestige ${next}! The climb begins again — stronger.`, 'good');
        milestones.forEach((m) => toast(`🏅 ${m.name} +${fmt(m.reward)} 🪙`, 'good'));
        game.attract(shopProfileObj().equipped);
        renderMenu();
      } catch (e) {
        toast(e.message, 'error');
      }
      S.shopTab = 'prestige';
      renderShop();
      show('shop');
    });
  }

  async function shopAction(kind, key) {
    try {
      if (S.shopProfile === 'online') {
        const res = kind === 'buy'
          ? await api('/api/shop/buy', { item: key })
          : await api('/api/shop/equip', { slot: key.split(':')[0], id: key.split(':')[1] });
        setPlayer(res.player);
      } else {
        const err = kind === 'buy' ? C.applyPurchase(S.offline, key) : C.applyEquip(S.offline, key.split(':')[0], key.split(':')[1]);
        if (err) throw new Error(err);
        saveOffline();
      }
      if (kind === 'buy') { sfx.coin(); toast('Purchased!', 'good'); } else sfx.click();
      game.attract(shopProfileObj().equipped);
      renderShop();
      renderMenu();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Leaderboard
  // -------------------------------------------------------------------------
  async function openLeaderboard() {
    show('leaderboard');
    renderLeaderboard();
  }

  async function renderLeaderboard() {
    $$('#lbTabs button').forEach((b) => b.classList.toggle('active', b.dataset.type === S.lbType));
    const table = $('#lbTable');
    const mine = $('#lbMine');
    if (!S.online) {
      table.innerHTML = '';
      mine.innerHTML = `The online leaderboard needs a connection. Your offline bests: <b>${fmt(S.offline.bestRound)}</b> pts round · <b>${fmtM(S.offline.bestKick)}</b> kick.`;
      return;
    }
    table.innerHTML = '<tr><td class="muted">Loading…</td></tr>';
    try {
      const type = S.lbType;
      const [lb] = await Promise.all([api(`/api/leaderboard?type=${type}`), S.player ? loadMe() : null]);
      if (type !== S.lbType) return;
      if (S.player) {
        const r = S.ranks || {};
        mine.innerHTML = `You: best round <b>${fmt(S.player.bestRound)}</b>${r.round ? ` (#${r.round})` : ''} · longest kick <b>${fmtM(S.player.bestKick)}</b>${r.kick ? ` (#${r.kick})` : ''}`;
      } else mine.textContent = 'Play a ranked round to get on the board!';
      if (!lb.rows.length) {
        table.innerHTML = '<tr><td class="muted">No kicks yet — be the first!</td></tr>';
        return;
      }
      const unit = type === 'kick' ? 'Distance' : 'Points';
      table.innerHTML = `<tr><th>#</th><th>Kicker</th><th style="text-align:right">${unit}</th><th></th></tr>` + lb.rows.map((r, i) => {
        const me = S.player && r.playerId === S.player.id;
        const val = type === 'kick' ? fmtM(r.value) : fmt(r.value);
        let act = '';
        if (r.roundId && type === 'kick' && r.kickIndex != null) act = `<button data-replay="${esc(r.roundId)}" data-idx="${r.kickIndex}" title="Watch replay">▶ Watch</button>`;
        else if (r.roundId && type !== 'kick' && !me) act = `<button data-challenge="${esc(r.roundId)}" title="Play the same 10 kicks">⚔️ Beat it</button>`;
        const medal = ['🥇', '🥈', '🥉'][i] || i + 1;
        const more = me ? '' : `<button class="mini-btn" data-player="${esc(r.playerId)}" data-pname="${esc(r.name)}" title="Report or block" aria-label="Report or block ${esc(r.name)}">⋯</button>`;
        return `<tr class="${me ? 'me' : ''}"><td class="rank">${medal}</td><td>${esc(r.name)}${stars(r.prestige)}<span class="lvl">${r.level}</span>${gearLine(r.equipped)}</td><td class="val">${val}</td><td class="act">${act}${more}</td></tr>`;
      }).join('');
    } catch (e) {
      table.innerHTML = `<tr><td class="error">${esc(e.message)}</td></tr>`;
    }
  }

  async function watchReplay(roundId, idx) {
    try {
      const r = await api(`/api/round/${encodeURIComponent(roundId)}`);
      const k = r.kicks[idx];
      if (!k) throw new Error('Replay not available');
      hideScreens();
      hud.show('replay', { replay: `${r.name} · ${fmtM(k.d)}` });
      game.startReplay({
        seed: P.kickSeed(r.baseSeed, idx), frame: k.f, upgrades: r.upgrades, equipped: r.equipped, power: k.pw || null,
        title: `${r.name}'s ${fmtM(k.d)} kick`,
        onEnd: () => { hud.hide(); game.attract(activeProfile().equipped); openLeaderboard(); },
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function offerChallenge(roundId) {
    try {
      const r = await api(`/api/round/${encodeURIComponent(roundId)}`);
      if (!r.finished) throw new Error('That round is still in progress');
      modal(`<h2>⚔️ Challenge</h2>
        <p><b>${esc(r.name)}</b> scored <b>${fmt(r.score)}</b> points.</p>
        <p class="muted">You'll get the exact same 10 juggles, wind and field. Your own upgrades apply. Can you beat them?</p>
        <div class="actions"><button class="btn primary" data-modal="go">Accept challenge</button><button class="btn" data-modal="close">Not now</button></div>`,
      (a) => {
        if (a === 'go') requirePlayer(() => startRanked({ id: r.id, score: r.score, name: r.name }));
        else goBackFromModal();
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------
  function openRooms() {
    renderRoom();
    show('rooms');
  }

  function renderRoom() {
    const body = $('#roomBody');
    if (!body) return;
    const room = S.room;
    if (!S.online) {
      body.innerHTML = '<p class="muted">Multiplayer needs a connection.</p>';
      return;
    }
    if (!room) {
      body.innerHTML = `
        <p class="muted">Everyone in the room gets the <b>same 10 juggles, wind and field</b>. Scores update live. The top kicker wins.</p>
        <div class="actions"><button class="btn primary" data-room="create">➕ Create a room</button></div>
        <h3>Join a friend's room</h3>
        <form id="joinForm" class="inline"><input id="joinCode" maxlength="4" placeholder="CODE" autocomplete="off" style="text-transform:uppercase;letter-spacing:.2em" /><button type="submit">Join</button></form>`;
      $('#joinForm').onsubmit = (e) => {
        e.preventDefault();
        const code = $('#joinCode').value.trim().toUpperCase();
        if (code.length === 4) wsSend({ t: 'room:join', code });
      };
      return;
    }
    const me = S.player && S.player.id;
    const isHost = room.hostId === me;
    const members = room.members.slice().sort((a, b) => (room.status === 'lobby' ? 0 : b.total - a.total));
    const list = members.map((m, i) => {
      const tag = `${m.id === room.hostId ? ' 👑' : ''}${m.id === me ? ' (you)' : ''}`;
      const right = room.status === 'lobby' ? (m.connected ? 'ready' : 'away')
        : `${fmt(m.total)} pts · ${m.done ? 'done' : `kick ${Math.min(m.kicks + 1, 10)}/10`}`;
      const medal = room.status !== 'lobby' ? `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ` : '';
      const more = m.id !== me ? `<button class="mini-btn" data-player="${esc(m.id)}" data-pname="${esc(m.name)}" title="Report or block" aria-label="Report or block ${esc(m.name)}">⋯</button>` : '';
      return `<li class="${m.connected ? '' : 'off'}"><span>${medal}${esc(m.name)}${tag}</span><span class="muted">${right}${more}</span></li>`;
    }).join('');
    let status = '';
    let actions = '';
    if (room.status === 'lobby') {
      status = isHost ? `<p class="muted">Share the code, then start when everyone's in.</p>` : '<p class="muted">Waiting for the host to start…</p>';
      actions = `${isHost ? `<button class="btn primary" data-room="start">▶ Start match (${room.members.filter((m) => m.connected).length} player${room.members.length === 1 ? '' : 's'})</button>` : ''}
        <button class="btn" data-room="share">🔗 Copy invite link</button>`;
    } else if (room.status === 'playing') {
      const mine = room.members.find((m) => m.id === me);
      status = mine && mine.done ? '<div class="banner blue">Nice kicking! Waiting for everyone else to finish…</div>' : '<p class="muted">Match in progress.</p>';
    } else {
      const winner = S.roomFinal && S.roomFinal[0];
      status = winner ? `<div class="banner">🏆 ${esc(winner.name)} is the top kicker with ${fmt(winner.total)} pts!</div>` : '';
      actions = isHost ? '<button class="btn primary" data-room="reset">🔁 Rematch</button>' : '<p class="muted">Waiting for the host to start a rematch…</p>';
    }
    body.innerHTML = `
      <div class="room-code">${esc(room.code)}</div>
      ${status}
      <ul class="room-members">${list}</ul>
      <label class="toggle"><input type="checkbox" id="fairToggle" ${room.fair ? 'checked' : ''} ${isHost && room.status !== 'playing' ? '' : 'disabled'} />
        Level playing field (everyone kicks with no upgrades)</label>
      <div class="actions">${actions}<button class="btn" data-room="leave">Leave room</button></div>
      <h3>Chat</h3>
      <div class="chat" id="roomChat"></div>
      <form id="chatForm" class="inline"><input id="chatInput" maxlength="120" placeholder="Talk some trash…" autocomplete="off" /><button type="submit">Send</button></form>`;
    $('#fairToggle').onchange = (e) => wsSend({ t: 'room:fair', fair: e.target.checked });
    $('#chatForm').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#chatInput').value.trim();
      if (v) wsSend({ t: 'room:chat', text: v });
      $('#chatInput').value = '';
    };
    renderChat();
  }

  function renderChat() {
    const el = $('#roomChat');
    if (!el) return;
    const me = S.player && S.player.id;
    el.innerHTML = S.roomChat.filter((m) => !isBlocked(m.id)).map((m, i) => `<div><b>${esc(m.name)}:</b> ${esc(m.text)}${m.id && m.id !== me
      ? ` <button class="mini-btn" data-player="${esc(m.id)}" data-pname="${esc(m.name)}" data-chat="${esc(m.text)}" title="Report or block" aria-label="Report or block ${esc(m.name)}">⋯</button>` : ''}</div>`).join('') || '<div class="muted">No messages yet.</div>';
    el.scrollTop = el.scrollHeight;
  }

  function renderRoomPanel() {
    const el = $('#roomPanel');
    const room = S.room;
    const show = room && room.status !== 'lobby' && S.current && S.current.kind === 'room' && game.playing;
    el.classList.toggle('hidden', !show);
    document.body.classList.toggle('room-active', !!show);
    if (!show) return;
    const me = S.player && S.player.id;
    // Your own row only moves when your result is on screen, never mid-kick.
    const view = room.members.map((m) => {
      if (m.id !== me || !game.k) return m;
      const k = game.k;
      const shown = k.phase === 'result' ? k.index + 1 : k.index;
      return Object.assign({}, m, { total: game.total || 0, kicks: shown, done: shown >= P.KICKS_PER_ROUND });
    });
    const rows = view.sort((a, b) => b.total - a.total).map((m, i) => `
      <div class="rp-row ${m.id === me ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${esc(m.name)}</span>
      <span>${fmt(m.total)} <span class="rp-kicks">${m.done ? '✓' : `${m.kicks}/10`}</span></span></div>`).join('');
    el.innerHTML = `<h4>Room ${esc(room.code)}</h4>${rows}`;
  }

  async function copyRoomLink() {
    const url = `${location.origin}/?room=${S.room.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Join my Eggers Kick Off room', url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Invite link copied!', 'good');
    } catch (e) {
      toast(`Room code: ${S.room.code}`, 'good');
    }
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------
  function legalLinksHtml() {
    const base = API_BASE || '';
    return `<p class="legal-links"><a href="${base}/privacy.html" target="_blank" rel="noopener">Privacy policy</a> ·
      <a href="${base}/terms.html" target="_blank" rel="noopener">Terms</a> ·
      <a href="${base}/privacy.html#delete" target="_blank" rel="noopener">Data &amp; deletion</a></p>`;
  }

  function confirmDeleteAccount() {
    const p = S.player;
    if (!p) return;
    modal(`<h2>🗑️ Delete ${esc(p.name)}?</h2>
      <p>This permanently deletes your online profile and everything in it. It cannot be undone.</p>
      <p class="muted">Type your kicker name to confirm:</p>
      <input id="deleteConfirm" autocomplete="off" maxlength="16" placeholder="${esc(p.name)}" />
      <p class="error" id="deleteError"></p>
      <div class="actions"><button class="btn danger" data-modal="yes">Delete forever</button><button class="btn" data-modal="no">Keep my account</button></div>`, async (a) => {
      if (a !== 'yes') { renderProfile(); show('profile'); return; }
      if ($('#deleteConfirm').value.trim().toLowerCase() !== p.name.toLowerCase()) {
        $('#deleteError').textContent = "That doesn't match your kicker name";
        return;
      }
      try {
        await api('/api/me', null, 'DELETE');
        forgetOnlineProfile();
        toast('Your account was deleted', 'good');
        renderMenu();
        goMenu();
      } catch (err) { $('#deleteError').textContent = err.message; }
    });
  }

  // "Install app": Android/desktop Chrome hand us an install prompt; iPhone needs Share → Add to Home Screen.
  let installPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; renderInstallButton(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; renderInstallButton(); toast('Installed! Find Eggers Kick Off on your home screen.', 'good'); });
  function renderInstallButton() {
    const b = $('#installBtn');
    if (b) b.classList.toggle('hidden', IS_APP || isStandalone() || !(installPrompt || isIos()));
  }
  async function installApp() {
    if (installPrompt) {
      installPrompt.prompt();
      try { await installPrompt.userChoice; } catch (e) { /* dismissed */ }
      installPrompt = null;
      renderInstallButton();
      return;
    }
    modal(`<h2>📲 Add to your Home Screen</h2>
      <ol class="howto"><li>Tap the <b>Share</b> button <span aria-hidden="true">⬆️</span> in Safari.</li>
      <li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Eggers Kick Off opens full-screen like an app.</li></ol>
      <div class="actions"><button class="btn primary" data-modal="close">Got it</button></div>`);
  }

  function renderProfile() {
    const body = $('#profileBody');
    const o = S.offline;
    let html = '';
    if (S.player) {
      const p = S.player;
      const r = S.ranks || {};
      html += `<h3>🌐 ${esc(p.name)} <span class="lvl">Lv ${p.level}</span></h3>
        <div class="stat-grid">
          <div class="stat"><span>Coins</span><b>🪙 ${fmt(p.coins)}</b></div>
          <div class="stat"><span>Best round</span><b>${fmt(p.bestRound)}</b></div>
          <div class="stat"><span>Longest kick</span><b>${fmtM(p.bestKick)}</b></div>
          <div class="stat"><span>Rounds</span><b>${fmt(p.roundsPlayed)}</b></div>
          <div class="stat"><span>Round rank</span><b>${r.round ? `#${r.round}` : '—'}</b></div>
          <div class="stat"><span>Kick rank</span><b>${r.kick ? `#${r.kick}` : '—'}</b></div>
        </div>
        <form id="renameForm" class="inline"><input id="renameInput" maxlength="16" value="${esc(p.name)}" /><button type="submit">Rename</button></form>
        <div class="banner ${p.hasPassword ? 'green' : ''}">${p.hasPassword
          ? '🔒 Password set — log in with your kicker name on any device.'
          : '⚠️ Set a password so you can log in on any device and never lose your progress.'}</div>
        <form id="passwordForm" class="pw-form">
          <input id="passwordInput" type="password" maxlength="64" minlength="4"
            placeholder="${p.hasPassword ? 'New password' : 'Choose a password (4+ characters)'}" autocomplete="new-password" />
          <input id="passwordConfirm" type="password" maxlength="64" minlength="4" placeholder="Type it again to confirm" autocomplete="new-password" />
          <label class="toggle"><input type="checkbox" data-showpw="#passwordInput,#passwordConfirm" /> 👁 Show password</label>
          <p class="error" id="passwordError"></p>
          <button class="btn primary" type="submit">${p.hasPassword ? 'Change password' : 'Set password'}</button></form>
        <details><summary>Transfer code (play on another device)</summary>
          <p class="muted">Keep this secret — anyone with it can use your profile. Paste it into "Already played on another device?" on the other device.</p>
          <code class="token">${esc(S.token)}</code>
          <div class="actions"><button class="btn" data-prof="copy">Copy code</button><button class="btn danger" data-prof="signout">Sign out on this device</button></div>
        </details>
        <details><summary>Delete account</summary>
          <p class="muted">Permanently deletes <b>${esc(p.name)}</b>: coins, upgrades, gear, Career, records and leaderboard spots. This can't be undone, and your device backup is erased too. Your offline profile on this device is kept.</p>
          <div class="actions"><button class="btn danger" data-prof="delete">🗑️ Delete my account</button></div>
        </details>`;
    } else if (S.online) {
      html += '<p class="muted">Create a kicker name to save progress online and get on the leaderboard.</p><div class="actions"><button class="btn primary" data-prof="create">Create kicker name</button></div>';
    }
    html += `<h3>📴 Offline profile <span class="lvl">Lv ${C.levelFromXp(o.xp)}</span></h3>
      <div class="stat-grid">
        <div class="stat"><span>Coins</span><b>🪙 ${fmt(o.coins)}</b></div>
        <div class="stat"><span>Best round</span><b>${fmt(o.bestRound)}</b></div>
        <div class="stat"><span>Longest kick</span><b>${fmtM(o.bestKick)}</b></div>
        <div class="stat"><span>Rounds</span><b>${fmt(o.roundsPlayed)}</b></div>
      </div>
      <div class="actions"><button class="btn" data-prof="reset">Reset offline progress</button>
      <button class="btn" data-prof="mute">${sfx.muted ? '🔇 Sound off' : '🔊 Sound on'}</button></div>`;
    const blockedIds = Object.keys(S.blocked);
    if (blockedIds.length) {
      html += `<h3>🚫 Blocked players</h3><ul class="room-members">${blockedIds.map((id) => `<li><span>${esc(S.blocked[id])}</span>
        <button class="btn small" data-unblock="${esc(id)}">Unblock</button></li>`).join('')}</ul>`;
    }
    html += legalLinksHtml();
    body.innerHTML = html;
    const pf = $('#passwordForm');
    if (pf) {
      pf.onsubmit = async (e) => {
        e.preventDefault();
        const pw = $('#passwordInput').value;
        $('#passwordError').textContent = '';
        if (pw.length < 4) { $('#passwordError').textContent = 'Use at least 4 characters'; return; }
        if (pw !== $('#passwordConfirm').value) { $('#passwordError').textContent = "Those passwords don't match — check and try again"; return; }
        try {
          const res = await api('/api/me/password', { password: pw });
          setPlayer(res.player);
          toast('Password saved — you can now log in anywhere', 'good');
          renderProfile();
        } catch (err) { toast(err.message, 'error'); }
      };
    }
    const rf = $('#renameForm');
    if (rf) {
      rf.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const res = await api('/api/me/name', { name: $('#renameInput').value });
          setPlayer(res.player);
          toast('Name updated', 'good');
          renderProfile();
          renderMenu();
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (a) {
      sfx.unlock();
      sfx.click();
      switch (a.dataset.action) {
        case 'ranked': requirePlayer(() => startRanked()); break;
        case 'rooms': requirePlayer(openRooms); break;
        case 'casual': startOffline(P.KICKS_PER_ROUND); break;
        case 'freekick': startOffline(Infinity); break;
        case 'shop': openShop(); break;
        case 'leaderboard': openLeaderboard(); break;
        case 'howto': $('#coinGuide').innerHTML = coinGuideHtml(); show('howto'); break;
        case 'career': openCareer(); break;
        case 'challenges': openChallenges(); break;
        case 'patchnotes': openPatchNotes(); break;
        case 'profile': renderProfile(); show('profile'); break;
        case 'back': goMenu(); break;
      }
      return;
    }
    const tab = e.target.closest('#shopTabs [data-tab]');
    if (tab) { S.shopTab = tab.dataset.tab; renderShop(); return; }
    const prof = e.target.closest('#shopProfileTabs [data-prof]');
    if (prof) { S.shopProfile = prof.dataset.prof; game.attract(shopProfileObj().equipped); renderShop(); return; }
    const buy = e.target.closest('[data-buy]');
    if (buy) { shopAction('buy', buy.dataset.buy); return; }
    if (e.target.closest('[data-prestige]')) { confirmPrestige(); return; }
    const eq = e.target.closest('[data-equip]');
    if (eq) { shopAction('equip', eq.dataset.equip); return; }
    const lb = e.target.closest('#lbTabs [data-type]');
    if (lb) { S.lbType = lb.dataset.type; renderLeaderboard(); return; }
    const boss = e.target.closest('[data-boss]');
    if (boss) { sfx.click(); startCareer(boss.dataset.boss); return; }
    const rp = e.target.closest('[data-replay]');
    if (rp) { watchReplay(rp.dataset.replay, Number(rp.dataset.idx)); return; }
    const ch = e.target.closest('[data-challenge]');
    if (ch) { offerChallenge(ch.dataset.challenge); return; }
    const room = e.target.closest('[data-room]');
    if (room) {
      sfx.click();
      const act = room.dataset.room;
      if (act === 'create') wsSend({ t: 'room:create' });
      else if (act === 'start') wsSend({ t: 'room:start' });
      else if (act === 'reset') wsSend({ t: 'room:reset' });
      else if (act === 'leave') wsSend({ t: 'room:leave' });
      else if (act === 'share') copyRoomLink();
      if (!S.wsOk) toast('Reconnecting to the server…', 'error');
      return;
    }
    const pa = e.target.closest('#profileBody [data-prof]');
    if (pa) {
      const act = pa.dataset.prof;
      if (act === 'copy') navigator.clipboard.writeText(S.token).then(() => toast('Copied', 'good'), () => toast('Copy failed — select the code manually', 'error'));
      else if (act === 'signout') {
        modal('<h2>Sign out?</h2><p class="muted">Make sure you\'ve saved your transfer code, or you won\'t be able to get this profile back.</p><div class="actions"><button class="btn danger" data-modal="yes">Sign out</button><button class="btn" data-modal="no">Cancel</button></div>', (x) => {
          if (x === 'yes') {
            forgetOnlineProfile();
            goMenu();
          } else { renderProfile(); show('profile'); }
        });
      } else if (act === 'create') requirePlayer(() => { renderProfile(); show('profile'); });
      else if (act === 'reset') {
        modal('<h2>Reset offline progress?</h2><p class="muted">Your offline coins, upgrades and gear will be wiped. Online progress is not affected.</p><div class="actions"><button class="btn danger" data-modal="yes">Reset</button><button class="btn" data-modal="no">Cancel</button></div>', (x) => {
          if (x === 'yes') { S.offline = C.newProfile(); saveOffline(); toast('Offline progress reset'); }
          renderProfile(); show('profile');
        });
      } else if (act === 'mute') { sfx.toggle(); renderProfile(); }
      else if (act === 'delete') confirmDeleteAccount();
      return;
    }
    const ub = e.target.closest('[data-unblock]');
    if (ub) { delete S.blocked[ub.dataset.unblock]; local.set('ek_blocked', S.blocked); renderProfile(); return; }
    const pm = e.target.closest('[data-player]');
    if (pm) { e.stopPropagation(); playerMenu(pm.dataset.player, pm.dataset.pname, pm.dataset.chat || ''); return; }
    if (e.target.closest('[data-install]')) { installApp(); return; }
  });

  // "Show password" checkboxes flip their fields between hidden and visible text.
  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-showpw]');
    if (!t) return;
    t.dataset.showpw.split(',').forEach((sel) => { const el = $(sel); if (el) el.type = t.checked ? 'text' : 'password'; });
  });

  $('#hudMenu').addEventListener('click', (e) => { e.stopPropagation(); quitPrompt(); });
  $('#hudMute').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#hudMute').textContent = sfx.toggle() ? '🔇' : '🔊';
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (game.mode === 'play' || game.mode === 'replay') { if (S.screen === 'modal') hideScreens(); else quitPrompt(); }
    else if (S.screen && S.screen !== 'menu' && S.screen !== 'end') goMenu();
  });

  $('#nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#nameError').textContent = '';
    try {
      const res = await api('/api/player', { name: $('#nameInput').value });
      S.token = res.token;
      local.set('ek_token', S.token);
      setPlayer(res.player);
      wsSend({ t: 'hello', token: S.token });
      toast(`Welcome, ${S.player.name}!`, 'good');
      renderMenu();
      const fn = S.pendingAfterName;
      S.pendingAfterName = null;
      if (fn) fn(); else goMenu();
    } catch (err) {
      $('#nameError').textContent = err.message;
    }
  });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#nameError').textContent = '';
    try {
      const res = await api('/api/login', { name: $('#loginName').value, password: $('#loginPassword').value });
      S.token = res.token;
      local.set('ek_token', S.token);
      setPlayer(res.player);
      wsSend({ t: 'hello', token: S.token });
      toast(`Welcome back, ${S.player.name}!`, 'good');
      renderMenu();
      const fn = S.pendingAfterName;
      S.pendingAfterName = null;
      if (fn) fn(); else goMenu();
    } catch (err) {
      $('#nameError').textContent = err.message;
    }
  });

  $('#transferForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#transferInput').value.trim();
    if (!code) return;
    const prev = S.token;
    S.token = code;
    try {
      const me = await api('/api/me');
      setPlayer(me.player);
      S.ranks = me.ranks;
      local.set('ek_token', code);
      wsSend({ t: 'hello', token: code });
      toast(`Welcome back, ${S.player.name}!`, 'good');
      const fn = S.pendingAfterName;
      S.pendingAfterName = null;
      if (fn) fn(); else goMenu();
    } catch (err) {
      S.token = prev;
      $('#nameError').textContent = err.status === 401 ? 'That transfer code was not recognised' : err.message;
    }
  });

  window.addEventListener('online', checkOnline);

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  async function boot() {
    goMenu();
    const params = new URLSearchParams(location.search);
    const challengeId = params.get('c');
    const roomCode = params.get('room');
    if (challengeId || roomCode) history.replaceState(null, '', location.pathname);
    await checkOnline();
    game.attract(activeProfile().equipped);
    renderPatchBadge();
    renderInstallButton();
    const latest = latestPatch();
    const returning = !!S.token || S.offline.roundsPlayed > 0 || S.offline.bestKick > 0;
    const unseen = latest && local.get(PATCH_SEEN_KEY, null) !== latest.version;
    if (challengeId && S.online) offerChallenge(challengeId);
    else if (!roomCode && returning && unseen) openPatchNotes();
    else if (roomCode && S.online) {
      requirePlayer(() => {
        S.wantRoom = roomCode.toUpperCase();
        if (S.wsOk) { wsSend({ t: 'room:join', code: S.wantRoom }); S.wantRoom = null; }
        openRooms();
      });
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      if (!IS_APP) navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  boot();
})();
