import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';

// Exercise the actual server matcher without loading an embedding model.
const filename = new URL('../lib/data.ts', import.meta.url);
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, require: createRequire(filename), process });
const { idx, pubs, queryMatches } = module.exports;
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

for (const fallback of [false, true]) {
  test(`explanations follow query theme and closest paper (${fallback ? 'lexical' : 'neural'})`, () => {
    const vectors = fallback ? idx.fallback.vectors : idx.vectors;
    for (const theme of idx.themes.slice(0, 4)) {
      const vector = vectors.publications[theme.representative_publications[0]];
      const result = queryMatches(vector, fallback);
      for (const match of result.faculty) {
        const expected = match.p.publications.map(id => pubs.find(p => p.id === id))
          .filter(Boolean).sort((a, b) => dot(vector, vectors.publications[b.id]) - dot(vector, vectors.publications[a.id]))[0];
        assert.equal(match.paper.id, expected.id);
        assert.ok(match.reason.includes(`“${expected.title}”`));
        assert.ok(match.reason.endsWith(`the ${result.themes[0].name} theme.`));
        assert.notEqual(match.reason, idx.explanations[match.p.id]);
      }
    }
  });
}
