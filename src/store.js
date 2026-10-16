'use strict';
/*
 * Persistence. Uses Postgres when DATABASE_URL is set (Railway's Postgres
 * plugin provides it automatically); otherwise a JSON file for local dev.
 */
const fs = require('fs');
const path = require('path');

const WEEK_MS = 7 * 24 * 3600 * 1000;

class NameTakenError extends Error {
  constructor() {
    super('That name is already taken');
    this.code = 'NAME_TAKEN';
  }
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------
class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(url);
    this.pool = new Pool({
      connectionString: url,
      ssl: local || process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 10,
    });
    this.kind = 'postgres';
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT UNIQUE NOT NULL,
        coins INTEGER NOT NULL DEFAULT 0,
        xp INTEGER NOT NULL DEFAULT 0,
        upgrades JSONB NOT NULL DEFAULT '{}'::jsonb,
        owned JSONB NOT NULL DEFAULT '[]'::jsonb,
        equipped JSONB NOT NULL DEFAULT '{}'::jsonb,
        best_round INTEGER NOT NULL DEFAULT 0,
        best_round_id TEXT,
        best_kick REAL NOT NULL DEFAULT 0,
        best_kick_round_id TEXT,
        best_kick_index INTEGER,
        rounds_played INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS players_best_round ON players (best_round DESC);
      CREATE INDEX IF NOT EXISTS players_best_kick ON players (best_kick DESC);
      CREATE TABLE IF NOT EXISTS rounds (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        base_seed BIGINT NOT NULL,
        upgrades JSONB NOT NULL DEFAULT '{}'::jsonb,
        kicks JSONB NOT NULL DEFAULT '[]'::jsonb,
        score INTEGER NOT NULL DEFAULT 0,
        finished BOOLEAN NOT NULL DEFAULT false,
        room TEXT,
        challenge_of TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS rounds_finished_at ON rounds (finished_at) WHERE finished;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS milestones JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS career JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE rounds ADD COLUMN IF NOT EXISTS career TEXT;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS daily JSONB NOT NULL DEFAULT '{}'::jsonb;
      CREATE TABLE IF NOT EXISTS player_tokens (
        token_hash TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  static rowToPlayer(r) {
    if (!r) return null;
    return {
      id: r.id,
      tokenHash: r.token_hash,
      name: r.name,
      nameKey: r.name_key,
      coins: r.coins,
      xp: r.xp,
      upgrades: r.upgrades || {},
      owned: r.owned || [],
      equipped: r.equipped || {},
      bestRound: r.best_round,
      bestRoundId: r.best_round_id,
      bestKick: Number(r.best_kick),
      bestKickRoundId: r.best_kick_round_id,
      bestKickIndex: r.best_kick_index,
      roundsPlayed: r.rounds_played,
      milestones: r.milestones || [],
      career: r.career || {},
      passwordHash: r.password_hash || null,
      daily: r.daily || {},
    };
  }

  static rowToRound(r) {
    if (!r) return null;
    return {
      id: r.id,
      playerId: r.player_id,
      baseSeed: Number(r.base_seed),
      upgrades: r.upgrades || {},
      kicks: r.kicks || [],
      score: r.score,
      finished: r.finished,
      room: r.room,
      challengeOf: r.challenge_of,
      career: r.career || null,
      createdAt: new Date(r.created_at).getTime(),
      finishedAt: r.finished_at ? new Date(r.finished_at).getTime() : null,
    };
  }

  async createPlayer(p) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO players (id, token_hash, name, name_key, coins, xp, upgrades, owned, equipped)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [p.id, p.tokenHash, p.name, p.nameKey, p.coins, p.xp,
          JSON.stringify(p.upgrades), JSON.stringify(p.owned), JSON.stringify(p.equipped)]
      );
      return PgStore.rowToPlayer(rows[0]);
    } catch (e) {
      if (e.code === '23505' && /name_key/.test(e.constraint || e.detail || '')) throw new NameTakenError();
      throw e;
    }
  }

  async getPlayerByTokenHash(h) {
    const { rows } = await this.pool.query(
      `SELECT * FROM players WHERE token_hash = $1
       UNION ALL
       SELECT p.* FROM player_tokens t JOIN players p ON p.id = t.player_id WHERE t.token_hash = $1
       LIMIT 1`, [h]);
    return PgStore.rowToPlayer(rows[0]);
  }

  async getPlayerByNameKey(nameKey) {
    const { rows } = await this.pool.query('SELECT * FROM players WHERE name_key = $1', [nameKey]);
    return PgStore.rowToPlayer(rows[0]);
  }

  async addToken(playerId, tokenHash) {
    await this.pool.query('INSERT INTO player_tokens (token_hash, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tokenHash, playerId]);
  }

  async getSetting(key) {
    const { rows } = await this.pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    return rows[0] ? rows[0].value : null;
  }

  async setSetting(key, value) {
    await this.pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
    return this.getSetting(key);
  }

  async getPlayer(id) {
    const { rows } = await this.pool.query('SELECT * FROM players WHERE id = $1', [id]);
    return PgStore.rowToPlayer(rows[0]);
  }

  async savePlayer(p) {
    try {
      await this.pool.query(
        `UPDATE players SET name=$2, name_key=$3, coins=$4, xp=$5, upgrades=$6, owned=$7, equipped=$8,
           best_round=$9, best_round_id=$10, best_kick=$11, best_kick_round_id=$12, best_kick_index=$13,
           rounds_played=$14, milestones=$15, career=$16, password_hash=$17, daily=$18
         WHERE id=$1`,
        [p.id, p.name, p.nameKey, p.coins, p.xp, JSON.stringify(p.upgrades), JSON.stringify(p.owned),
          JSON.stringify(p.equipped), p.bestRound, p.bestRoundId, p.bestKick, p.bestKickRoundId,
          p.bestKickIndex, p.roundsPlayed, JSON.stringify(p.milestones || []), JSON.stringify(p.career || {}),
          p.passwordHash || null, JSON.stringify(p.daily || {})]
      );
    } catch (e) {
      if (e.code === '23505') throw new NameTakenError();
      throw e;
    }
  }

  async createRound(r) {
    await this.pool.query(
      `INSERT INTO rounds (id, player_id, base_seed, upgrades, kicks, score, finished, room, challenge_of, career)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [r.id, r.playerId, r.baseSeed, JSON.stringify(r.upgrades), JSON.stringify(r.kicks), r.score,
        r.finished, r.room, r.challengeOf, r.career || null]
    );
    return r;
  }

  async getRound(id) {
    const { rows } = await this.pool.query('SELECT * FROM rounds WHERE id = $1', [id]);
    return PgStore.rowToRound(rows[0]);
  }

  async saveRound(r) {
    await this.pool.query(
      `UPDATE rounds SET kicks=$2, score=$3, finished=$4, finished_at=$5 WHERE id=$1`,
      [r.id, JSON.stringify(r.kicks), r.score, r.finished, r.finishedAt ? new Date(r.finishedAt) : null]
    );
  }

  async leaderboard(type, limit) {
    let rows;
    if (type === 'kick') {
      ({ rows } = await this.pool.query(
        `SELECT id, name, best_kick AS value, best_kick_round_id AS round_id, best_kick_index AS kick_index, xp
         FROM players WHERE best_kick > 0 ORDER BY best_kick DESC, created_at ASC LIMIT $1`, [limit]));
    } else if (type === 'week') {
      ({ rows } = await this.pool.query(
        `SELECT p.id, p.name, b.score AS value, b.id AS round_id, NULL AS kick_index, p.xp FROM (
           SELECT DISTINCT ON (player_id) id, player_id, score FROM rounds
           WHERE finished AND finished_at > now() - interval '7 days'
           ORDER BY player_id, score DESC, finished_at ASC
         ) b JOIN players p ON p.id = b.player_id
         ORDER BY b.score DESC LIMIT $1`, [limit]));
    } else {
      ({ rows } = await this.pool.query(
        `SELECT id, name, best_round AS value, best_round_id AS round_id, NULL AS kick_index, xp
         FROM players WHERE best_round > 0 ORDER BY best_round DESC, created_at ASC LIMIT $1`, [limit]));
    }
    return rows.map((r) => ({
      playerId: r.id, name: r.name, value: Number(r.value), roundId: r.round_id,
      kickIndex: r.kick_index, xp: r.xp,
    }));
  }

  async rankOf(type, player) {
    if (type === 'kick') {
      if (!player.bestKick) return null;
      const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM players WHERE best_kick > $1', [player.bestKick]);
      return rows[0].n + 1;
    }
    if (type === 'round') {
      if (!player.bestRound) return null;
      const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM players WHERE best_round > $1', [player.bestRound]);
      return rows[0].n + 1;
    }
    return null;
  }

  async stats() {
    const { rows } = await this.pool.query(
      `SELECT (SELECT count(*)::int FROM players) AS players,
              (SELECT count(*)::int FROM rounds WHERE finished) AS rounds`);
    return rows[0];
  }
}

// ---------------------------------------------------------------------------
// JSON file (local development / single-instance fallback)
// ---------------------------------------------------------------------------
class FileStore {
  constructor(dir) {
    this.file = path.join(dir, 'eggers-kick-off.json');
    this.kind = 'file';
    this.data = { players: {}, rounds: {} };
    this.saveTimer = null;
  }

  async init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    }
    this.data.tokens = this.data.tokens || {};
    this.data.settings = this.data.settings || {};
    this.byToken = new Map(Object.entries(this.data.tokens));
    this.byName = new Map();
    for (const p of Object.values(this.data.players)) {
      this.byToken.set(p.tokenHash, p.id);
      this.byName.set(p.nameKey, p.id);
    }
  }

  persist() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      // Drop abandoned rounds older than a day to keep the file small.
      const cutoff = Date.now() - 24 * 3600 * 1000;
      for (const [id, r] of Object.entries(this.data.rounds)) {
        if (!r.finished && r.createdAt < cutoff) delete this.data.rounds[id];
      }
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    }, 500);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    }
  }

  clone(o) {
    return o ? JSON.parse(JSON.stringify(o)) : null;
  }

  async createPlayer(p) {
    if (this.byName.has(p.nameKey)) throw new NameTakenError();
    const row = Object.assign({
      bestRound: 0, bestRoundId: null, bestKick: 0, bestKickRoundId: null, bestKickIndex: null,
      roundsPlayed: 0, createdAt: Date.now(),
    }, this.clone(p));
    this.data.players[p.id] = row;
    this.byToken.set(p.tokenHash, p.id);
    this.byName.set(p.nameKey, p.id);
    this.persist();
    return this.clone(row);
  }

  async getPlayerByTokenHash(h) {
    const id = this.byToken.get(h);
    return id ? this.clone(this.data.players[id]) : null;
  }

  async getPlayer(id) {
    return this.clone(this.data.players[id]);
  }

  async getPlayerByNameKey(nameKey) {
    const id = this.byName.get(nameKey);
    return id ? this.clone(this.data.players[id]) : null;
  }

  async addToken(playerId, tokenHash) {
    this.data.tokens[tokenHash] = playerId;
    this.byToken.set(tokenHash, playerId);
    this.persist();
  }

  async getSetting(key) {
    return this.data.settings[key] == null ? null : this.data.settings[key];
  }

  async setSetting(key, value) {
    if (this.data.settings[key] == null) {
      this.data.settings[key] = value;
      this.persist();
    }
    return this.data.settings[key];
  }

  async savePlayer(p) {
    const cur = this.data.players[p.id];
    if (!cur) return;
    if (cur.nameKey !== p.nameKey) {
      const owner = this.byName.get(p.nameKey);
      if (owner && owner !== p.id) throw new NameTakenError();
      this.byName.delete(cur.nameKey);
      this.byName.set(p.nameKey, p.id);
    }
    this.data.players[p.id] = Object.assign(cur, this.clone(p));
    this.persist();
  }

  async createRound(r) {
    this.data.rounds[r.id] = Object.assign({ createdAt: Date.now(), finishedAt: null }, this.clone(r));
    this.persist();
    return r;
  }

  async getRound(id) {
    return this.clone(this.data.rounds[id]);
  }

  async saveRound(r) {
    if (!this.data.rounds[r.id]) return;
    Object.assign(this.data.rounds[r.id], this.clone(r));
    this.persist();
  }

  async leaderboard(type, limit) {
    const players = Object.values(this.data.players);
    let rows;
    if (type === 'kick') {
      rows = players.filter((p) => p.bestKick > 0)
        .sort((a, b) => b.bestKick - a.bestKick || a.createdAt - b.createdAt)
        .map((p) => ({ playerId: p.id, name: p.name, value: p.bestKick, roundId: p.bestKickRoundId, kickIndex: p.bestKickIndex, xp: p.xp }));
    } else if (type === 'week') {
      const cutoff = Date.now() - WEEK_MS;
      const best = new Map();
      for (const r of Object.values(this.data.rounds)) {
        if (!r.finished || r.finishedAt < cutoff) continue;
        const b = best.get(r.playerId);
        if (!b || r.score > b.score) best.set(r.playerId, r);
      }
      rows = [...best.values()].sort((a, b) => b.score - a.score).map((r) => {
        const p = this.data.players[r.playerId];
        return { playerId: p.id, name: p.name, value: r.score, roundId: r.id, kickIndex: null, xp: p.xp };
      });
    } else {
      rows = players.filter((p) => p.bestRound > 0)
        .sort((a, b) => b.bestRound - a.bestRound || a.createdAt - b.createdAt)
        .map((p) => ({ playerId: p.id, name: p.name, value: p.bestRound, roundId: p.bestRoundId, kickIndex: null, xp: p.xp }));
    }
    return rows.slice(0, limit);
  }

  async rankOf(type, player) {
    const players = Object.values(this.data.players);
    if (type === 'kick') return player.bestKick ? players.filter((p) => p.bestKick > player.bestKick).length + 1 : null;
    if (type === 'round') return player.bestRound ? players.filter((p) => p.bestRound > player.bestRound).length + 1 : null;
    return null;
  }

  async stats() {
    return {
      players: Object.keys(this.data.players).length,
      rounds: Object.values(this.data.rounds).filter((r) => r.finished).length,
    };
  }
}

async function createStore() {
  const url = process.env.DATABASE_URL;
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const hosted = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV === 'production');
  if (!url && hosted && !volume && !process.env.DATA_DIR && process.env.ALLOW_EPHEMERAL_STORAGE !== 'true') {
    // A JSON file on a hosted container's own disk is wiped on every deploy. Refuse to start
    // so the deploy fails and the previous (working) deployment keeps serving players.
    throw new Error(
      'Refusing to start: no DATABASE_URL. Player progress would be erased on the next deploy. ' +
      'Add a Postgres database and reference its DATABASE_URL on this service (or attach a volume).'
    );
  }
  const store = url ? new PgStore(url) : new FileStore(process.env.DATA_DIR || volume || path.join(__dirname, '..', 'data'));
  await store.init();
  return store;
}

module.exports = { createStore, NameTakenError };
