const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/store');

test('refuses to run on a hosted container without a permanent database', async () => {
  const saved = { ...process.env };
  try {
    delete process.env.DATABASE_URL;
    delete process.env.DATA_DIR;
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    process.env.RAILWAY_ENVIRONMENT = 'production';
    await assert.rejects(createStore(), /Refusing to start/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
