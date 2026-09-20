// Apply reviewed LLM labels without rebuilding embeddings or modifying the corpus.
import fs from 'node:fs/promises';
import { loadThemeLabels, themeKey, validateThemeLabel } from '../lib/theme-labels.mjs';

const indexPath = new URL('../data/index.json', import.meta.url);
const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
const labels = await loadThemeLabels();
const replacements = new Map();
for (const theme of index.themes) {
  if (!theme.name.includes('/') && !/^Research on\b/i.test(theme.description)) continue;
  const key = themeKey(index.meta.embedding_model, theme.representative_publications);
  const label = labels[key];
  if (!label || label.titles?.length !== 10 || label.publication_ids?.length !== 10) {
    throw new Error(`Missing top 10 publication evidence for ${theme.id}`);
  }
  replacements.set(theme.name, validateThemeLabel(label).name);
  Object.assign(theme, validateThemeLabel(label));
}
for (const theme of index.themes) validateThemeLabel(theme);
const replaceNames = text => {
  for (const [before, after] of replacements) text = text.split(before).join(after);
  return text;
};
for (const group of index.groups) group.name = replaceNames(group.name);
for (const id of Object.keys(index.explanations)) index.explanations[id] = replaceNames(index.explanations[id]);
await fs.writeFile(new URL('../data/cache/explanations.json', import.meta.url), JSON.stringify(index.explanations, null, 2));
await fs.writeFile(indexPath, JSON.stringify(index));
console.log(`Regenerated ${replacements.size} theme labels; validated all ${index.themes.length} themes.`);
