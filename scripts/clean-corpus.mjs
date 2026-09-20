import fs from 'node:fs/promises';

const corpusPath = 'data/corpus.json';
const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
const currentYear = new Date().getUTCFullYear();
const recentCutoff = currentYear - 3;

const realNameTokens = name =>
  (name.normalize('NFKC').match(/\p{L}[\p{L}\p{M}'’-]*/gu) || [])
    .filter(token => [...token].filter(char => /\p{L}/u.test(char)).length >= 2);

// Oversized consortium papers are excluded before any person-level count.
const publications = corpus.publications.filter(publication =>
  Array.isArray(publication.author_ids) && publication.author_ids.length <= 50
);
const publicationsByAuthor = new Map();
for (const publication of publications) {
  for (const authorId of publication.author_ids) {
    if (!publicationsByAuthor.has(authorId)) publicationsByAuthor.set(authorId, []);
    publicationsByAuthor.get(authorId).push(publication);
  }
}

const people = corpus.people.filter(person => {
  const works = publicationsByAuthor.get(person.id) || [];
  return realNameTokens(person.name).length >= 2 &&
    works.length >= 3 &&
    works.some(work => work.year >= recentCutoff) &&
    works.some(work => work.author_ids[0] === person.id || work.author_ids.at(-1) === person.id);
});
const peopleIds = new Set(people.map(person => person.id));

const retainedPublications = publications.filter(publication =>
  publication.author_ids.some(authorId => peopleIds.has(authorId))
);
const retainedPublicationIds = new Set(retainedPublications.map(publication => publication.id));
const retainedByAuthor = new Map();
for (const publication of retainedPublications) {
  for (const authorId of publication.author_ids) {
    if (!peopleIds.has(authorId)) continue;
    if (!retainedByAuthor.has(authorId)) retainedByAuthor.set(authorId, []);
    retainedByAuthor.get(authorId).push(publication);
  }
}

// OpenAlex awards are paper acknowledgements, not verified sponsored projects.
// Keep only funder provenance tied to a retained first/last author, with dates removed.
const leadTitles = new Map();
for (const publication of retainedPublications) {
  for (const authorId of [publication.author_ids[0], publication.author_ids.at(-1)]) {
    if (!peopleIds.has(authorId)) continue;
    if (!leadTitles.has(authorId)) leadTitles.set(authorId, new Set());
    leadTitles.get(authorId).add(publication.title.toLocaleLowerCase());
  }
}
const projects = corpus.projects.filter(project => project.person_ids.some(personId => {
  const titles = leadTitles.get(personId);
  if (!titles) return false;
  const evidence = `${project.title || ''} ${project.description || ''}`.toLocaleLowerCase();
  return [...titles].some(title => title.length > 8 && evidence.includes(title));
})).map(project => ({
  ...project,
  start_date: null,
  end_date: null,
  person_ids: project.person_ids.filter(personId => peopleIds.has(personId) &&
    [...(leadTitles.get(personId) || [])].some(title =>
      `${project.title || ''} ${project.description || ''}`.toLocaleLowerCase().includes(title)))
})).filter(project => project.person_ids.length);
const projectIds = new Set(projects.map(project => project.id));

for (const person of people) {
  const works = retainedByAuthor.get(person.id) || [];
  person.publications = works.map(work => work.id).filter(id => retainedPublicationIds.has(id));
  person.projects = (person.projects || []).filter(id => projectIds.has(id));
  const collaborators = new Map();
  for (const work of works) for (const coauthorId of work.author_ids) {
    if (coauthorId === person.id || !peopleIds.has(coauthorId)) continue;
    const prior = collaborators.get(coauthorId) || { id: coauthorId, count: 0, latest_year: 0 };
    prior.count += 1;
    prior.latest_year = Math.max(prior.latest_year, work.year || 0);
    collaborators.set(coauthorId, prior);
  }
  person.coauthors = [...collaborators.values()].sort((a, b) => b.count - a.count);
}

corpus.meta = {
  ...corpus.meta,
  cleaned_at: new Date().toISOString(),
  cleaning: `Excluded works with >50 authors; retained people with >=3 works, a work since ${recentCutoff}, a first/last authorship, and >=2 real name tokens. Awards are acknowledgement provenance only.`
};
corpus.people = people;
corpus.publications = retainedPublications;
corpus.projects = projects;
await fs.writeFile(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`People remaining after filtering: ${people.length}`);
console.log(`Publications remaining: ${retainedPublications.length}`);
console.log(`Lead-author funder acknowledgements retained: ${projects.length}`);
