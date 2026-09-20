# Orange Coauthor

An offline-first demo that maps a university research corpus into themes, co-authorship groups, and explainable faculty/group/student matches.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. To regenerate the checked-in fallback corpus and derived index, run `npm run data`.

## Data provenance

The intended public sources are Experts@Syracuse (Elsevier Pure) and SURFACE (Digital Commons/OAI-PMH). The build environment could not reach either host, so the checked-in corpus uses the documented last-resort fallback: 300 clearly marked synthetic people with 1,200 publications and 150 projects. It must not be represented as real Syracuse coverage. `scripts/scrape-syracuse.mjs` implements cache-first, one-request-per-second retrieval, exponential backoff, an identifying user agent, and robots-first discovery for a future network-enabled run.

## Architecture

- `data/corpus.json`: normalized source entities.
- `data/index.json`: persisted deterministic vectors, 60 content-derived themes, capacity evidence, and recency-filtered co-authorship groups.
- `data/students.json`: 15 hand-written student posts.
- `lib/data.ts`: offline retrieval/ranking layer.
- `app/`: Next.js App Router screens for theme map, idea intake, matches, faculty feed, theme details, and group details.

Matching follows the requested profiles conceptually and always presents a cited paper, project, or theme as its explanation. The faculty availability toggle is explicit, browser-local demo state; activity is never described as willingness.

## Constraints

See `DECISIONS.md` for every ambiguity choice and known limitation. No runtime request depends on a Syracuse server.
