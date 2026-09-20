import corpus from '../data/corpus.json';
import idx from '../data/index.json';

export {corpus, idx};
export const people = corpus.people;
export const pubs = corpus.publications;
export const projects = corpus.projects;

const pubById = new Map(pubs.map(publication => [publication.id, publication]));
const termIndex = new Map(idx.embedding.vocabulary.map((word, index) => [word, index]));
const stopwords = new Set('a an and are as at be been by can for from has have in into is it its of on or our that the their this to using via was were with within'.split(' '));
const embed = (text: string) => {
  const counts = new Map<string, number>();
  const words = text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [];
  for (const word of words) if (!stopwords.has(word) && termIndex.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  const vector = Array(idx.embedding.vocabulary.length).fill(0);
  for (const [word, count] of counts) {
    const index = termIndex.get(word)!;
    vector[index] = (1 + Math.log(count)) * idx.embedding.idf[index];
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map(value => value / norm);
};
const similarity = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);

export function facultyMatches(query = 'climate health data') {
  const queryVector = embed(query);
  return people.map(person => {
    const personVector = idx.vectors.people[person.id as keyof typeof idx.vectors.people] as number[];
    const signal = idx.signals[person.id as keyof typeof idx.signals];
    const papers = person.publications.map(id => pubById.get(id)).filter((paper): paper is NonNullable<typeof paper> => Boolean(paper));
    const paper = papers.sort((a, b) => {
      const aVector = idx.vectors.publications[a.id as keyof typeof idx.vectors.publications] as number[];
      const bVector = idx.vectors.publications[b.id as keyof typeof idx.vectors.publications] as number[];
      return similarity(queryVector, bVector) - similarity(queryVector, aVector);
    })[0];
    const directSimilarity = Math.max(0, similarity(queryVector, personVector));
    const themeFit = Math.max(0, ...idx.themes.map(theme => similarity(queryVector, theme.centroid) * similarity(personVector, theme.centroid)));
    const recency = Math.max(0, 1 - (new Date().getUTCFullYear() - signal.publication_recency) / 4);
    const output = Math.min(1, signal.recent_output / 8);
    const score = .55 * themeFit + .25 * directSimilarity + .12 * recency + .08 * output;
    return {p: person, paper, signal, score, reason: idx.explanations[person.id as keyof typeof idx.explanations]};
  }).filter(match => match.paper).sort((a, b) => b.score - a.score).slice(0, 12);
}
