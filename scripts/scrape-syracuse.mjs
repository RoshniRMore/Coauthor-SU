/**
 * Resumable collector for real Syracuse University research records.
 *
 * Experts@Syracuse is the preferred source, but its Pure portal currently puts
 * every useful /en route behind a Cloudflare managed challenge and returns no
 * robots.txt. We therefore do not crawl it. OpenAlex is the structured public
 * fallback: it exposes cursor-paginated works, authors, affiliations, abstracts,
 * venues, and grant identifiers, and its robots.txt explicitly allows crawling.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'data', 'cache', 'syracuse-real');
const OUTPUT = path.join(ROOT, 'data', 'corpus.json');
const UA = 'Orange Coauthor student research project (mailto:orange-coauthor@example.com)';
const SYRACUSE_ID = 'I70983195';
const OPENALEX = 'https://api.openalex.org';
const FROM_DATE = process.env.SYRACUSE_FROM_DATE || '2021-01-01';
const MAX_PAGES = Number(process.env.SYRACUSE_MAX_PAGES || 0); // 0 means exhaust cursor pagination.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

await fs.mkdir(CACHE, { recursive: true });

function cacheFile(url) {
  return path.join(CACHE, `${crypto.createHash('sha256').update(url).digest('hex')}.json`);
}

async function get(url, { cache = true, attempt = 0 } = {}) {
  const file = cacheFile(url);
  if (cache) {
    try { return await fs.readFile(file, 'utf8'); } catch {}
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain;q=0.9,text/html;q=0.8' },
    redirect: 'follow',
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    const retryAfter = Number(response.headers.get('retry-after')) * 1000;
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter
      : 1000 * 2 ** attempt + Math.random() * 500;
    console.warn(`Retrying ${response.status} ${url} in ${Math.round(delay)}ms`);
    await wait(delay);
    return get(url, { cache, attempt: attempt + 1 });
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} ${url}`);
  const body = await response.text();
  if (cache) await fs.writeFile(file, body);
  await wait(850 + Math.random() * 300);
  return body;
}

function parseRobots(text) {
  const rules = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') applies = value === '*' || value.toLowerCase().includes('orangecoauthor');
    else if (applies && (key === 'allow' || key === 'disallow')) rules.push({ type: key, path: value });
  }
  return rules;
}

function robotsAllows(rules, pathname) {
  const matches = rules
    .filter(rule => rule.path && pathname.startsWith(rule.path.replace(/\*.*$/, '')))
    .sort((a, b) => b.path.length - a.path.length);
  return !matches.length || matches[0].type === 'allow';
}

async function checkRobots(base) {
  const url = `${base}/robots.txt`;
  try {
    const text = await get(url, { cache: false });
    return { ok: true, text, rules: parseRobots(text) };
  } catch (error) {
    return { ok: false, error: String(error.message || error), rules: [] };
  }
}

function abstractFromIndex(index) {
  if (!index) return null;
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.join(' ').trim() || null;
}

function shortId(value) {
  return String(value || '').replace(/^https:\/\/openalex\.org\//, '');
}

function cleanDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null;
}

function emptyState() {
  return {
    people: new Map(),
    publications: new Map(),
    projects: new Map(),
    collaborations: new Map(),
  };
}

function addCollaboration(state, authorIds, year) {
  for (let i = 0; i < authorIds.length; i++) {
    for (let j = i + 1; j < authorIds.length; j++) {
      const key = [authorIds[i], authorIds[j]].sort().join('|');
      const current = state.collaborations.get(key) || { count: 0, latest_year: 0 };
      current.count += 1;
      current.latest_year = Math.max(current.latest_year, year || 0);
      state.collaborations.set(key, current);
    }
  }
}

function consumeWork(state, work, departmentOnly = null) {
  const department = work.primary_topic?.field?.display_name || 'Interdisciplinary Research';
  if (departmentOnly && department !== departmentOnly) return;

  const syracuseAuthors = (work.authorships || [])
    .filter(authorship => (authorship.institutions || []).some(inst => shortId(inst.id) === SYRACUSE_ID))
    .map(authorship => ({
      id: shortId(authorship.author?.id),
      name: authorship.author?.display_name?.trim(),
    }))
    .filter(author => author.id && author.name);
  if (!syracuseAuthors.length || !work.title?.trim()) return;

  const publicationId = shortId(work.id);
  const year = Number(work.publication_year) || null;
  const authorIds = [...new Set(syracuseAuthors.map(author => author.id))];
  state.publications.set(publicationId, {
    id: publicationId,
    title: work.title.trim(),
    abstract: abstractFromIndex(work.abstract_inverted_index),
    year,
    venue: work.primary_location?.source?.display_name || null,
    author_ids: authorIds,
    url: work.doi || work.primary_location?.landing_page_url || work.id,
  });

  for (const author of syracuseAuthors) {
    const person = state.people.get(author.id) || {
      id: author.id,
      name: author.name,
      title: 'Faculty or researcher',
      departments: new Set(),
      profile_url: `https://openalex.org/${author.id}`,
      publications: new Set(),
      projects: new Set(),
      coauthors: [],
    };
    person.departments.add(department);
    person.publications.add(publicationId);
    state.people.set(author.id, person);
  }

  addCollaboration(state, authorIds, year);

  for (const grant of work.awards || []) {
    const awardId = grant.award_id || grant.id;
    const funderId = grant.funder_id || grant.funder;
    if (!awardId && !funderId) continue;
    const grantId = `grant-${shortId(funderId || 'unknown')}-${shortId(awardId || publicationId)}`;
    const project = state.projects.get(grantId) || {
      id: grantId,
      title: grant.display_name || grant.title || (awardId ? `Research award ${shortId(awardId)}` : `Research award linked to ${work.title.trim()}`),
      description: `Grant reported by OpenAlex on the publication “${work.title.trim()}”.`,
      start_date: cleanDate(work.publication_date),
      end_date: null,
      funder: grant.funder_display_name || shortId(funderId) || null,
      person_ids: new Set(),
    };
    for (const authorId of authorIds) {
      project.person_ids.add(authorId);
      state.people.get(authorId)?.projects.add(grantId);
    }
    state.projects.set(grantId, project);
  }
}

function serialise(state, source, scope) {
  for (const [key, edge] of state.collaborations) {
    const [a, b] = key.split('|');
    if (state.people.has(a) && state.people.has(b)) {
      state.people.get(a).coauthors.push({ id: b, ...edge });
      state.people.get(b).coauthors.push({ id: a, ...edge });
    }
  }
  const people = [...state.people.values()].map(person => ({
    ...person,
    departments: [...person.departments].sort(),
    publications: [...person.publications],
    projects: [...person.projects],
    coauthors: person.coauthors.sort((a, b) => b.count - a.count),
  })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    meta: {
      source,
      synthetic: false,
      generated_at: new Date().toISOString(),
      scope,
    },
    people,
    publications: [...state.publications.values()],
    projects: [...state.projects.values()].map(project => ({ ...project, person_ids: [...project.person_ids] })),
  };
}

async function writeCorpus(corpus) {
  const temporary = `${OUTPUT}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(corpus, null, 2)}\n`);
  await fs.rename(temporary, OUTPUT);
}

function validateProof(corpus) {
  const namePattern = /^[\p{L}][\p{L} .,'’()-]{2,}$/u;
  const realPeople = corpus.people.filter(person => namePattern.test(person.name));
  const realTitles = corpus.publications.filter(pub => pub.title.length >= 8 && !/^research (paper|publication)/i.test(pub.title));
  if (!realPeople.length || !realTitles.length || !realPeople.some(person => person.publications.length)) {
    throw new Error('Proof gate failed: no real names with real publication titles were collected.');
  }
}

async function* openAlexWorks() {
  let cursor = '*';
  let page = 0;
  do {
    const params = new URLSearchParams({
      filter: `institutions.id:${SYRACUSE_ID},from_publication_date:${FROM_DATE}`,
      'per-page': '200',
      cursor,
      select: 'id,doi,title,publication_year,publication_date,primary_location,authorships,abstract_inverted_index,primary_topic,awards',
      mailto: 'orange-coauthor@example.com',
    });
    const url = `${OPENALEX}/works?${params}`;
    const pageData = JSON.parse(await get(url));
    page += 1;
    console.log(`OpenAlex page ${page}: ${pageData.results.length} works`);
    yield pageData.results;
    cursor = pageData.meta?.next_cursor;
    if (MAX_PAGES && page >= MAX_PAGES) break;
  } while (cursor);
}

const failures = [];
const expertsRobots = await checkRobots('https://experts.syr.edu');
if (!expertsRobots.ok) {
  failures.push(`Experts@Syracuse robots unavailable (${expertsRobots.error}); Pure crawl skipped`);
} else if (!robotsAllows(expertsRobots.rules, '/en/')) {
  failures.push('Experts@Syracuse robots disallows /en/; Pure crawl skipped');
} else {
  // Live probes show this route is Cloudflare-challenged. Keep discovery explicit,
  // but never attempt to bypass access controls.
  failures.push('Experts@Syracuse /en routes require a Cloudflare browser challenge; Pure crawl skipped');
}

const openAlexRobots = await checkRobots(OPENALEX);
if (!openAlexRobots.ok || !robotsAllows(openAlexRobots.rules, '/works')) {
  throw new Error(`OpenAlex robots check failed or disallowed /works: ${openAlexRobots.error || 'disallowed'}`);
}

const route = `${OPENALEX}/works (cursor pagination; Syracuse institution ${SYRACUSE_ID})`;
console.log(`Route found: ${route}`);

const proofDepartment = 'Computer Science';
const proof = emptyState();
const full = emptyState();
let proofWritten = false;

for await (const works of openAlexWorks()) {
  for (const work of works) {
    consumeWork(full, work);
    if (!proofWritten) consumeWork(proof, work, proofDepartment);
  }
  if (!proofWritten && proof.people.size > 0 && proof.publications.size > 0) {
    const proofCorpus = serialise(proof, 'OpenAlex (Syracuse University institution record)', `proof: ${proofDepartment}`);
    validateProof(proofCorpus);
    await writeCorpus(proofCorpus);
    proofWritten = true;
    console.log(`Proof department ${proofDepartment}: ${proofCorpus.people.length} people, ${proofCorpus.publications.length} publications`);
  }
}

if (!proofWritten) throw new Error(`Proof gate failed: ${proofDepartment} returned zero usable records.`);

const corpus = serialise(
  full,
  'OpenAlex public API; Syracuse University institution I70983195 (Experts@Syracuse Pure fallback)',
  `all Syracuse-affiliated disciplinary units; publications since ${FROM_DATE}`,
);
validateProof(corpus);
await writeCorpus(corpus);

console.log(`Route used: ${route}`);
console.log(`People: ${corpus.people.length}`);
console.log(`Publications: ${corpus.publications.length}`);
console.log(`Projects: ${corpus.projects.length}`);
console.log(`Failures: ${failures.length ? failures.join('; ') : 'none'}`);
