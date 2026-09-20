import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { embedText, embedQuery, lexicalEmbed } from '../lib/embeddings.mjs';

test('neural paraphrases rank above unrelated text; repeated inputs reuse disk cache', async () => {
  const query = 'How does hot weather affect the health of elderly city residents?';
  const before = new Set(await fs.readdir('data/cache/neural-v1'));
  const vector = await embedText(query);
  assert.equal(vector.length, 384);
  assert.ok(vector.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-6);
  const files = await fs.readdir('data/cache/neural-v1');
  const created = files.filter(file => !before.has(file));
  const times = await Promise.all(created.map(async file => (await fs.stat(`data/cache/neural-v1/${file}`)).mtimeMs));
  assert.deepEqual(await embedText(query), vector);
  assert.deepEqual(await Promise.all(created.map(async file => (await fs.stat(`data/cache/neural-v1/${file}`)).mtimeMs)), times);
  const related = await embedText('Extreme heat and medical risks among older adults in urban neighborhoods.');
  const unrelated = await embedText('Black holes and gravitational waves from merging stars.');
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  assert.ok(dot(vector, related) > dot(vector, unrelated) + 0.2);
});

test('lexical fallback uses the indexed vocabulary and handles out-of-vocabulary input', () => {
  const config = { vocabulary: ['climate', 'health'], idf: [2, 3] };
  assert.deepEqual(lexicalEmbed('unknown', config), [0, 0]);
  assert.deepEqual(lexicalEmbed('health health', config), [0, 1]);
});

test('a lexical index forces explicit fallback, with a loud warning and lexical query vector', async () => {
  const previous = console.error;
  const warnings = [];
  console.error = (...args) => warnings.push(args.join(' '));
  try {
    const result = await embedQuery('health', 'tf-idf-384', { vocabulary: ['health'], idf: [2] });
    assert.equal(result.fallback, true);
    assert.equal(result.model, 'tf-idf-384');
    assert.deepEqual(result.vector, [1]);
    assert.match(result.warning, /WARNING: NEURAL EMBEDDINGS UNAVAILABLE/);
    assert.equal(warnings.length, 1);
  } finally { console.error = previous; }
});
