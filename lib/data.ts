import corpus from '../data/corpus.json';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import students from '../data/students.json';

type Vectors = { people: Record<string, number[]>; publications: Record<string, number[]>; students: Record<string, number[]> };
export type Theme = { id: string; name: string; description: string; centroid: number[]; representative_publications: string[]; person_ids: string[]; faculty_count: number; publication_count: number; recent_publications: number };
export type Group = { id: string; name: string; member_ids: string[]; theme_id: string; publication_ids: string[]; cohesion: number; recency: number };
type Index = {
  meta: { embedding_model: string; recent_cutoff: number };
  embedding: { vocabulary: string[]; idf: number[] };
  vectors: Vectors; fallback: { vectors: Vectors };
  themes: Theme[]; groups: Group[];
  signals: Record<string, { recent_output: number; publication_recency: number; opted_in: boolean }>;
  explanations: Record<string, string>;
};
const idx: Index = JSON.parse(readFileSync(path.join(process.cwd(), 'data/index.json'), 'utf8'));

export {corpus, idx};
export const people = corpus.people;
export const pubs = corpus.publications;
export const projects = corpus.projects;

const pubById = new Map(pubs.map(publication => [publication.id, publication]));
const similarity = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);

export function facultyMatches(queryVector: number[], fallback = false) {
  const vectors = fallback ? idx.fallback.vectors : idx.vectors;
  return people.map(person => {
    const personVector = vectors.people[person.id as keyof typeof vectors.people] as number[];
    const signal = idx.signals[person.id as keyof typeof idx.signals];
    const papers = person.publications.map(id => pubById.get(id)).filter((paper): paper is NonNullable<typeof paper> => Boolean(paper));
    const paper = papers.sort((a, b) => {
      const aVector = vectors.publications[a.id as keyof typeof vectors.publications] as number[];
      const bVector = vectors.publications[b.id as keyof typeof vectors.publications] as number[];
      return similarity(queryVector, bVector) - similarity(queryVector, aVector);
    })[0];
    const directSimilarity = Math.max(0, similarity(queryVector, personVector));
    const themeFit = fallback ? directSimilarity : Math.max(0, ...idx.themes.map(theme => similarity(queryVector, theme.centroid) * similarity(personVector, theme.centroid)));
    const recency = Math.max(0, 1 - (new Date().getUTCFullYear() - signal.publication_recency) / 4);
    const output = Math.min(1, signal.recent_output / 8);
    const score = .55 * themeFit + .25 * directSimilarity + .12 * recency + .08 * output;
    return {p: person, paper, signal, score, reason: idx.explanations[person.id as keyof typeof idx.explanations]};
  }).filter(match => match.paper).sort((a, b) => b.score - a.score).slice(0, 12);
}

export function queryMatches(vector: number[], fallback: boolean) {
  const vectors = fallback ? idx.fallback.vectors : idx.vectors;
  const themes = [...idx.themes].map(theme => ({ ...theme, score: fallback
    ? theme.representative_publications.reduce((sum, id) => sum + similarity(vector, vectors.publications[id]), 0) / Math.max(1, theme.representative_publications.length)
    : similarity(vector, theme.centroid)
  })).sort((a, b) => b.score - a.score).slice(0, 2).map(({centroid, ...theme}) => theme);
  const groups = [...idx.groups].map(group => ({ ...group,
    score: group.member_ids.reduce((sum, id) => sum + similarity(vector, vectors.people[id]), 0) / group.member_ids.length,
    theme_name: idx.themes.find(theme => theme.id === group.theme_id)?.name
  })).sort((a, b) => b.score - a.score).slice(0, 3);
  return {
    faculty: facultyMatches(vector, fallback), groups, themes,
    students: students.map(student => ({...student, score: Math.max(0, similarity(vector, vectors.students[student.id]))})).sort((a,b) => b.score-a.score).slice(0, 3),
    recent_cutoff: idx.meta.recent_cutoff
  };
}
export type QueryMatches = ReturnType<typeof queryMatches>;
