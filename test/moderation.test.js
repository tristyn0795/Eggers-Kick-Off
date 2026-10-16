const test = require('node:test');
const assert = require('node:assert');
const { isOffensive, maskText } = require('../src/moderation');

test('catches slurs and swears, including look-alike spellings', () => {
  for (const t of ['shit', 'Sh1t', 'F.U.C.K', 'n1gg3r', 'a$$hole', 'kys', 'big ass', 'B!tch']) assert.ok(isOffensive(t), t);
});

test('leaves innocent words alone', () => {
  for (const t of ['Grapefruit', 'Peacock', 'Therapist', 'Dickens', 'Classic Kicker', 'Cocktail', 'Sussex', 'Jason', 'Henry the duck']) {
    assert.ok(!isOffensive(t), t);
  }
});

test('masks only the offending words in chat', () => {
  assert.strictEqual(maskText('what a shitty kick lol'), 'what a ****** kick lol');
  assert.strictEqual(maskText('great kick!'), 'great kick!');
});
