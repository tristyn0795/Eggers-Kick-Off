const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Every push to main goes straight to production, so make sure no browser script has a syntax error.
test('every browser script parses', () => {
  const dirs = ['public/js', 'shared'].map((d) => path.join(__dirname, '..', d));
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => path.join(d, f)));
  files.push(path.join(__dirname, '..', 'public', 'sw.js'), path.join(__dirname, '..', 'public', 'app-config.js'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }), `${path.relative(process.cwd(), f)} has a syntax error`);
  }
});

test('index.html references only files that exist', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"?#]+)/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const r of refs) {
    const file = r.startsWith('/shared/') ? path.join(root, r) : path.join(root, 'public', r);
    assert.ok(fs.existsSync(file), `${r} is missing`);
  }
});
