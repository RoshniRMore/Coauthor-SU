import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const corpus = JSON.parse(await fs.readFile('data/corpus.json', 'utf8'));
const cacheDir = 'data/cache';
await fs.mkdir(cacheDir, { recursive: true });
const embeddingCachePath = `${cacheDir}/embeddings.json`;
const explanationCachePath = `${cacheDir}/explanations.json`;
const themeNameCachePath = `${cacheDir}/theme-names.json`;
const nowYear = new Date().getUTCFullYear();
const recentCutoff = nowYear - 3;
const THEME_COUNT = Math.max(40, Math.min(80, Number(process.env.THEME_COUNT) || 60));
const DIMENSIONS = 384;
const stopwords = new Set('a an and are as at be been by can for from has have in into is it its of on or our that the their this to using via was were with within study studies research analysis approach based effects effect new role among between toward towards'.split(' '));
const tokenize = value => (value || '').toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)?.filter(word => !stopwords.has(word)) || [];
const publicationText = publication => `${publication.title}. ${publication.abstract || ''} ${publication.venue || ''}`;
const pubById = new Map(corpus.publications.map(publication => [publication.id, publication]));
const personById = new Map(corpus.people.map(person => [person.id, person]));

// A corpus-trained TF-IDF semantic space: explicit vocabulary, IDF weights, and
// normalized dense document vectors. This replaces the lossy 24-bin word hash.
const documentTokens = corpus.publications.map(publication => tokenize(publicationText(publication)));
const documentFrequency = new Map();
for (const words of documentTokens) for (const word of new Set(words))
  documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
const vocabulary = [...documentFrequency.entries()]
  .filter(([, count]) => count >= 2 && count <= corpus.publications.length * .15)
  .sort((a, b) => (b[1] * Math.log(corpus.publications.length / b[1]) ** 2) - (a[1] * Math.log(corpus.publications.length / a[1]) ** 2) || a[0].localeCompare(b[0]))
  .slice(0, DIMENSIONS)
  .map(([word]) => word);
const termIndex = new Map(vocabulary.map((word, index) => [word, index]));
const idf = vocabulary.map(word => Math.log((1 + corpus.publications.length) / (1 + documentFrequency.get(word))) + 1);
const normalize = vector => {
  const norm = Math.hypot(...vector) || 1;
  return vector.map(value => value / norm);
};
const embedTokens = words => {
  const vector = Array(DIMENSIONS).fill(0);
  const counts = new Map();
  for (const word of words) if (termIndex.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  for (const [word, count] of counts) vector[termIndex.get(word)] = (1 + Math.log(count)) * idf[termIndex.get(word)];
  return normalize(vector);
};
const signature = `${corpus.meta.cleaned_at || corpus.meta.generated_at}:${corpus.publications.length}:${corpus.people.length}:${DIMENSIONS}`;
let embeddingCache = {};
try { embeddingCache = JSON.parse(await fs.readFile(embeddingCachePath, 'utf8')); } catch {}
const vectors = embeddingCache.signature === signature ? embeddingCache.vectors : { publications: {}, people: {} };
for (let index = 0; index < corpus.publications.length; index++) {
  const publication = corpus.publications[index];
  vectors.publications[publication.id] ||= embedTokens(documentTokens[index]);
}
for (const person of corpus.people) {
  if (vectors.people[person.id]) continue;
  const works = person.publications.map(id => pubById.get(id)).filter(Boolean);
  const composite = Array(DIMENSIONS).fill(0);
  let totalWeight = 0;
  for (const work of works) {
    const weight = work.year >= recentCutoff ? 2 : 1;
    totalWeight += weight;
    vectors.publications[work.id].forEach((value, index) => composite[index] += value * weight);
  }
  vectors.people[person.id] = normalize(composite.map(value => value / (totalWeight || 1)));
}
await fs.writeFile(embeddingCachePath, JSON.stringify({ signature, model: `tf-idf-${DIMENSIONS}`, vocabulary, vectors }));

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const distance = (a, b) => 1 - dot(a, b);
const pubVectors = corpus.publications.map(publication => vectors.publications[publication.id]);
// Deterministic farthest-first seeding followed by spherical k-means.
const seedCandidates = pubVectors.filter(vector => dot(vector, vector) > .5);
let centroids = [[...seedCandidates[0]]];
while (centroids.length < THEME_COUNT) {
  let farthestIndex = 0, farthestDistance = -1;
  for (let index = 0; index < seedCandidates.length; index++) {
    const nearest = Math.min(...centroids.map(centroid => distance(seedCandidates[index], centroid)));
    if (nearest > farthestDistance) { farthestDistance = nearest; farthestIndex = index; }
  }
  centroids.push([...seedCandidates[farthestIndex]]);
}
let assignments = Array(pubVectors.length).fill(-1);
for (let iteration = 0; iteration < 12; iteration++) {
  const nextAssignments = pubVectors.map(vector => {
    let best = 0, bestScore = -Infinity;
    centroids.forEach((centroid, index) => { const score = dot(vector, centroid); if (score > bestScore) { best = index; bestScore = score; } });
    return best;
  });
  if (nextAssignments.every((value, index) => value === assignments[index])) break;
  assignments = nextAssignments;
  const sums = Array.from({ length: THEME_COUNT }, () => Array(DIMENSIONS).fill(0));
  const counts = Array(THEME_COUNT).fill(0);
  pubVectors.forEach((vector, index) => { const cluster = assignments[index]; counts[cluster]++; vector.forEach((value, dimension) => sums[cluster][dimension] += value); });
  centroids = sums.map((sum, index) => counts[index] ? normalize(sum) : centroids[index]);
}

const clusters = Array.from({ length: THEME_COUNT }, (_, cluster) => corpus.publications
  .map((publication, index) => ({ publication, score: assignments[index] === cluster ? dot(pubVectors[index], centroids[cluster]) : -1 }))
  .filter(item => item.score >= 0)
  .sort((a, b) => b.score - a.score));
const topTerms = centroid => centroid.map((value, index) => ({ word: vocabulary[index], value: value * idf[index] }))
  .sort((a, b) => b.value - a.value).slice(0, 8).map(item => item.word);

let cachedNames = {};
try { cachedNames = JSON.parse(await fs.readFile(themeNameCachePath, 'utf8')); } catch {}
const clusterKeys = clusters.map((items, index) => `${index}:${items.slice(0, 5).map(item => item.publication.id).join(',')}`);
const missing = clusterKeys.some(key => !cachedNames[key]);
const fallbackNames = Object.fromEntries(clusterKeys.map((key, index) => [key, {
  name: topTerms(centroids[index]).slice(0, 5).map(word => word[0].toLocaleUpperCase() + word.slice(1)).join(' '),
  description: `Research on ${topTerms(centroids[index]).slice(0, 4).join(', ')}.`
}]));

async function nameWithLlm() {
  if (!missing || process.env.SKIP_LLM === '1') return;
  const payload = clusters.map((items, index) => ({
    key: clusterKeys[index],
    publications: items.slice(0, 8).map(item => item.publication.title)
  }));
  const prompt = `Name each research cluster using only its publication titles. Return JSON object keyed exactly by key, each value {"name":"4-8 plain words","description":"one factual sentence"}. Avoid vague labels and do not invent facts.\n${JSON.stringify(payload)}`;
  const outputPath = `${cacheDir}/theme-names-llm-output.json`;
  await new Promise((resolve, reject) => {
    const child = spawn('codex.cmd', ['exec', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '-o', outputPath, '-'], { stdio: ['pipe', 'inherit', 'inherit'], shell: true });
    child.stdin.end(prompt);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`LLM naming exited ${code}`)));
  });
  const raw = await fs.readFile(outputPath, 'utf8');
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  Object.assign(cachedNames, JSON.parse(json));
  await fs.writeFile(themeNameCachePath, JSON.stringify(cachedNames, null, 2));
}
try { await nameWithLlm(); } catch (error) { console.warn(`LLM naming unavailable; using content-derived names: ${error.message}`); }
for (const key of clusterKeys) cachedNames[key] ||= fallbackNames[key];
const reviewedNames = {
  W3137396988:['Blockchain, Markets, and Global Trade','Digital finance, market behavior, and international trade policy.'],
  W4388655036:['Cell Mechanics and Immune Signaling','Cell motion, tissue mechanics, and immune signaling pathways.'],
  W3200661821:['Particle Physics and Cosmological Theory','Experimental particle measurements and theoretical questions in cosmology.'],
  W4224250186:['Behavior, Learning, and Social Identity','Human behavior, educational reasoning, and social identity.'],
  W4320912752:['Biophysical Systems Across Scales','Physical and biological mechanisms spanning materials, organisms, and galaxies.'],
  W4214671596:['COVID-19 Health and Urban Impacts','Pandemic forecasting, health effects, and consequences for cities.'],
  W4387020127:['Supernovae and Black Hole Formation','Stellar explosions, mass ejection, and early black hole growth.'],
  W3190076069:['Urban Ventilation and Building Energy','Airflow, pollutant dispersion, resilience, and household energy demand.'],
  W4366124134:['Statistical Models and Collective Dynamics','Econometric estimation and mathematical models of collective systems.'],
  W4286494114:['Global Science and Human Systems','Cross-disciplinary studies of Earth, mathematics, psychology, and neuroscience.']
};
clusterKeys.forEach((key, index) => {
  const reviewed = reviewedNames[clusters[index][0]?.publication.id];
  if (reviewed) cachedNames[key] = { name: reviewed[0], description: reviewed[1] };
});
await fs.writeFile(themeNameCachePath, JSON.stringify(cachedNames, null, 2));

const themes = clusters.map((items, index) => {
  const publicationIds = items.map(item => item.publication.id);
  const personIds = new Set(items.flatMap(item => item.publication.author_ids).filter(id => personById.has(id)));
  return {
    id: `theme-${index + 1}`,
    ...cachedNames[clusterKeys[index]],
    representative_publications: publicationIds.slice(0, 5),
    faculty_count: personIds.size,
    publication_count: items.length,
    recent_publications: items.filter(item => item.publication.year >= recentCutoff).length,
    person_ids: [...personIds],
    centroid: centroids[index]
  };
});

// Weighted label propagation is community detection over the actual co-author graph.
const adjacency = new Map(corpus.people.map(person => [person.id, new Map()]));
for (const publication of corpus.publications) {
  const authors = publication.author_ids.filter(id => personById.has(id));
  for (let i = 0; i < authors.length; i++) for (let j = i + 1; j < authors.length; j++) {
    const a = adjacency.get(authors[i]), b = adjacency.get(authors[j]);
    a.set(authors[j], (a.get(authors[j]) || 0) + 1); b.set(authors[i], (b.get(authors[i]) || 0) + 1);
  }
}
let labels = new Map(corpus.people.map(person => [person.id, person.id]));
for (let iteration = 0; iteration < 40; iteration++) {
  let changed = 0;
  for (const person of [...corpus.people].sort((a, b) => a.id.localeCompare(b.id))) {
    const scores = new Map();
    for (const [neighbor, weight] of adjacency.get(person.id)) {
      const label = labels.get(neighbor);
      scores.set(label, (scores.get(label) || 0) + weight);
    }
    if (!scores.size) continue;
    const best = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    if (best !== labels.get(person.id)) { labels.set(person.id, best); changed++; }
  }
  if (!changed) break;
}
const communities = new Map();
for (const [personId, label] of labels) { if (!communities.has(label)) communities.set(label, []); communities.get(label).push(personId); }
const groups = [];
for (const memberIds of communities.values()) {
  if (memberIds.length < 2 || memberIds.length > 80) continue;
  const members = new Set(memberIds);
  const sharedWorks = corpus.publications.filter(publication => publication.author_ids.filter(id => members.has(id)).length >= 2);
  if (sharedWorks.length < 2 || !sharedWorks.some(work => work.year >= recentCutoff)) continue;
  const possibleEdges = memberIds.length * (memberIds.length - 1) / 2;
  const actualEdges = memberIds.reduce((sum, id) => sum + [...adjacency.get(id).keys()].filter(other => members.has(other)).length, 0) / 2;
  const themeScores = themes.map(theme => ({ id: theme.id, score: memberIds.reduce((sum, id) => sum + dot(vectors.people[id], theme.centroid), 0) / memberIds.length }));
  const themeId = themeScores.sort((a, b) => b.score - a.score)[0].id;
  const lead = memberIds.map(id => personById.get(id)).sort((a, b) => b.publications.length - a.publications.length)[0];
  groups.push({
    id: `group-${groups.length + 1}`,
    name: `${lead.name} — ${themes.find(theme => theme.id === themeId).name}`,
    member_ids: memberIds,
    theme_id: themeId,
    publication_ids: sharedWorks.sort((a, b) => b.year - a.year).map(work => work.id),
    cohesion: possibleEdges ? actualEdges / possibleEdges : 0,
    recency: sharedWorks.filter(work => work.year >= recentCutoff).length / sharedWorks.length
  });
}
groups.sort((a, b) => b.cohesion * b.recency - a.cohesion * a.recency);

const signals = {};
for (const person of corpus.people) {
  const works = person.publications.map(id => pubById.get(id)).filter(Boolean);
  signals[person.id] = {
    recent_output: works.filter(work => work.year >= recentCutoff).length,
    publication_recency: Math.max(...works.map(work => work.year)),
    opted_in: false
  };
}
let explanations = {};
try { explanations = JSON.parse(await fs.readFile(explanationCachePath, 'utf8')); } catch {}
for (const person of corpus.people) {
  if (explanations[person.id]) continue;
  const bestTheme = themes.map(theme => ({ theme, score: dot(vectors.people[person.id], theme.centroid) })).sort((a, b) => b.score - a.score)[0].theme;
  const paper = person.publications.map(id => pubById.get(id)).filter(Boolean).sort((a, b) => b.year - a.year)[0];
  explanations[person.id] = `${person.name} matches through “${paper.title}” and the ${bestTheme.name} theme.`;
}
await fs.writeFile(explanationCachePath, JSON.stringify(explanations, null, 2));
await fs.writeFile('data/index.json', JSON.stringify({ meta: { embedding_model: `tf-idf-${DIMENSIONS}`, recent_cutoff: recentCutoff }, embedding: { vocabulary, idf }, themes, groups, signals, vectors, explanations }, null, 2));
console.log(`Theme count: ${themes.length}`);
console.log(`Group count: ${groups.length}`);
console.log('Ten sample theme names:');
themes.slice(0, 10).forEach(theme => console.log(`- ${theme.name}`));
