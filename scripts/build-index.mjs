import fs from 'node:fs/promises';
import { embedText, MODEL, lexicalEmbed } from '../lib/embeddings.mjs';

const corpus = JSON.parse(await fs.readFile('data/corpus.json', 'utf8'));
const cacheDir = 'data/cache';
await fs.mkdir(cacheDir, { recursive: true });
const explanationCachePath = `${cacheDir}/explanations.json`;
const nowYear = new Date().getUTCFullYear();
const recentCutoff = nowYear - 3;
const THEME_COUNT = Math.max(40, Math.min(80, Number(process.env.THEME_COUNT) || 60));
const DIMENSIONS = 384;
const stopwords = new Set('a an and are as at be been by can for from has have in into is it its of on or our that the their this to using via was were with within study studies research analysis approach based effects effect new role among between toward towards'.split(' '));
const tokenize = value => (value || '').toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)?.filter(word => !stopwords.has(word)) || [];
const publicationText = publication => `${publication.title}. ${publication.abstract || ''} ${publication.venue || ''}`;
const pubById = new Map(corpus.publications.map(publication => [publication.id, publication]));
const personById = new Map(corpus.people.map(person => [person.id, person]));

// Retain a separate lexical space for explicit offline fallback only.
const documentTokens = corpus.publications.map(publication => tokenize(publicationText(publication)));
const documentFrequency = new Map();
for (const words of documentTokens) for (const word of new Set(words))
  documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
const vocabulary = [...documentFrequency.entries()]
  .filter(([, count]) => count >= 2 && count <= corpus.publications.length * .15)
  .sort((a, b) => (b[1] * Math.log(corpus.publications.length / b[1]) ** 2) - (a[1] * Math.log(corpus.publications.length / a[1]) ** 2) || a[0].localeCompare(b[0]))
  .slice(0, DIMENSIONS)
  .map(([word]) => word);
const idf = vocabulary.map(word => Math.log((1 + corpus.publications.length) / (1 + documentFrequency.get(word))) + 1);
const normalize = vector => {
  const norm = Math.hypot(...vector) || 1;
  return vector.map(value => value / norm);
};
const students = JSON.parse(await fs.readFile('data/students.json', 'utf8'));
const personText = person => [person.name, ...person.departments, ...person.publications.map(id => pubById.get(id)).filter(Boolean).map(publicationText)].join('. ');
const lexical = { vocabulary, idf };
const fallbackVectors = { publications: {}, people: {}, students: {} };
for (const pub of corpus.publications) fallbackVectors.publications[pub.id] = lexicalEmbed(publicationText(pub), lexical);
for (const person of corpus.people) {
  const composite = Array(DIMENSIONS).fill(0);
  for (const work of person.publications.map(id => pubById.get(id)).filter(Boolean)) {
    const weight = work.year >= recentCutoff ? 2 : 1;
    fallbackVectors.publications[work.id].forEach((value, dimension) => composite[dimension] += value * weight);
  }
  fallbackVectors.people[person.id] = normalize(composite);
}
for (const student of students) fallbackVectors.students[student.id] = lexicalEmbed(student.idea, lexical);
let vectors = { publications: {}, people: {}, students: {} };
let embeddingModel = MODEL;
try {
  for (const [kind, records, getText] of [
    ['publications', corpus.publications, publicationText],
    ['people', corpus.people, personText],
    ['students', students, student => student.idea]
  ]) {
    for (let i = 0; i < records.length; i++) {
      vectors[kind][records[i].id] = await embedText(getText(records[i]));
      if (i % 250 === 0) console.log(`Embedded ${kind}: ${i + 1}/${records.length}`);
    }
  }
} catch (error) {
  console.error(`WARNING: NEURAL EMBEDDINGS UNAVAILABLE. USING TF-IDF FALLBACK: ${error.message}`);
  embeddingModel = `tf-idf-${DIMENSIONS}`;
  vectors = fallbackVectors;
}

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const distance = (a, b) => 1 - dot(a, b);
const pubVectors = corpus.publications.map(publication => vectors.publications[publication.id]);
// Deterministic farthest-first seeding followed by spherical k-means.
const seedCandidates = pubVectors.filter(vector => dot(vector, vector) > .5);
console.log('Deriving themes with spherical k-means...');
let centroids = [[...seedCandidates[0]]];
const nearestDistances = Array(seedCandidates.length).fill(Infinity);
while (centroids.length < THEME_COUNT) {
  let farthestIndex = 0, farthestDistance = -1;
  for (let index = 0; index < seedCandidates.length; index++) {
    const nearest = Math.min(nearestDistances[index], distance(seedCandidates[index], centroids[centroids.length - 1]));
    nearestDistances[index] = nearest;
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
// Neural dimensions are not words. Label clusters from their member documents.
const topTerms = items => {
  const counts = new Map();
  for (const { publication } of items.slice(0, 30)) {
    for (const word of new Set(tokenize(publicationText(publication))))
      counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts].map(([word, count]) => ({word, score: count * Math.log((1 + corpus.publications.length) / (1 + (documentFrequency.get(word) || 0)))}))
    .sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.word);
};
// Reviewed labels from the representative titles; invalidate when representatives change.
const reviewedNames = {
  "Xenova/all-MiniLM-L6-v2:W4398193981,W4392567417,W4409045795,W4409324312,W4385214308": {
    "name": "Entrepreneurial Finance and Sustainable Ventures",
    "description": "Entrepreneurial funding, startup markets, and environmental and social performance."
  },
  "Xenova/all-MiniLM-L6-v2:W4386076031,W4319300011,W4394597621,W4403488453,W4366310357": {
    "name": "Neural Learning for Point Clouds",
    "description": "Contrastive learning, feature fusion, and classification of three-dimensional point clouds."
  },
  "Xenova/all-MiniLM-L6-v2:W4414790062,W4402633669,W4387252643,W3161940344,W7167638248": {
    "name": "Social Justice and Antiracist Institutions",
    "description": "Antiracist practice, media justice, and institutional change in information studies."
  },
  "Xenova/all-MiniLM-L6-v2:W7156898800,W3203745194,W7199547026,W4411088407,W3132404058": {
    "name": "Immune Signaling and Therapeutic Biomaterials",
    "description": "Macrophage-targeting materials, inflammatory damage, and peptide-based therapies."
  },
  "Xenova/all-MiniLM-L6-v2:W4392122595,W7127194890,W3138151157,W7148614652,W4366594192": {
    "name": "Hydrogel Scaffolds and Biomedical Printing",
    "description": "Dynamic scaffolds, printable hydrogels, and multiscale perfusable models."
  },
  "Xenova/all-MiniLM-L6-v2:W4414052865,W7155178166,W4415122038,W3180660291,W4327694623": {
    "name": "Speech Perception and Childhood Disorders",
    "description": "Speech sound disorders, auditory perception, and biofeedback treatment."
  },
  "Xenova/all-MiniLM-L6-v2:W4281479600,W4411426908,W3190444875,W4408435664,W7134272283": {
    "name": "Forest Watersheds and Climate Change",
    "description": "Watershed hydrology, biogeochemistry, and long-term responses to climate and acidification."
  },
  "Xenova/all-MiniLM-L6-v2:W4294690811,W4289943244,W3157491515,W4386174146,W4382138379": {
    "name": "Exoskeleton Control and Assisted Movement",
    "description": "Closed-loop control of exoskeletons, electrical stimulation, and assisted cycling."
  },
  "Xenova/all-MiniLM-L6-v2:W4299356718,W4407074772,W4400442409,W4403433208,W4416006791": {
    "name": "Artificial Intelligence and Organizational Work",
    "description": "Information systems, artificial intelligence, and changes in work and management."
  },
  "Xenova/all-MiniLM-L6-v2:W4281258505,W7117468286,W4401107045,W4414149897,W4385230620": {
    "name": "Alcohol Use and Treatment Outcomes",
    "description": "Alcohol treatment, drinking-related harms, and interventions for people with chronic conditions."
  }
};
const clusterKeys = clusters.map(items => `${embeddingModel}:${items.slice(0, 5).map(item => item.publication.id).join(',')}`);
const cachedNames = Object.fromEntries(clusters.map((items, index) => {
  const terms = topTerms(items);
  return [clusterKeys[index], reviewedNames[clusterKeys[index]] || {
    name: terms.map(word => word[0].toUpperCase() + word.slice(1)).join(' / '),
    description: `Research on ${terms.join(', ')}.`
  }];
}));

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
// Recompute explanations against the newly derived themes.
for (const person of corpus.people) {
  if (explanations[person.id]) continue;
  const bestTheme = themes.map(theme => ({ theme, score: dot(vectors.people[person.id], theme.centroid) })).sort((a, b) => b.score - a.score)[0].theme;
  const paper = person.publications.map(id => pubById.get(id)).filter(Boolean).sort((a, b) => b.year - a.year)[0];
  explanations[person.id] = `${person.name} matches through “${paper.title}” and the ${bestTheme.name} theme.`;
}
await fs.writeFile(explanationCachePath, JSON.stringify(explanations, null, 2));
await fs.writeFile('data/index.json', JSON.stringify({ meta: { embedding_model: embeddingModel, recent_cutoff: recentCutoff }, embedding: { vocabulary, idf }, fallback: { vectors: fallbackVectors }, themes, groups, signals, vectors, explanations }, (_, value) => typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(8)) : value));
console.log(`Embedding model: ${embeddingModel}`);
console.log(`Theme count: ${themes.length}`);
console.log(`Group count: ${groups.length}`);
console.log('Ten sample theme names:');
themes.slice(0, 10).forEach(theme => console.log(`- ${theme.name}`));
