# Orange Coauthor

An offline-first demo that maps a university research corpus into themes, co-authorship groups, and explainable faculty/group/student matches.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. To regenerate the checked-in fallback corpus and derived index, run `npm run data`.

## Data provenance

The checked-in corpus contains 1,512 Syracuse-affiliated researchers and 10,779 publications from the OpenAlex public API, using Syracuse University institution `I70983195`. Experts@Syracuse (Elsevier Pure) was the intended source, but its routes sit behind a Cloudflare browser challenge. The scraper does not attempt to bypass that challenge and transparently falls back to OpenAlex.

Raw ingestion returned 6,658 author records. The cleaning pass in `scripts/clean-corpus.mjs` excluded works with more than 50 authors, then retained only people with at least three works, a publication since 2023, at least one first or last authorship, and a plausible parsed name (at least two name tokens containing two or more letters). The 2023 cutoff describes this snapshot; reruns use the current UTC year minus three. These filters define the corpus's coverage, rather than a complete or verified faculty directory.

OpenAlex grant records are funder acknowledgements extracted from publications, not sponsored-project records. Retained acknowledgements provide provenance only: all grant dates and active-funding claims were removed rather than displayed without supporting evidence.

## Architecture

- `data/corpus.json`: normalized source entities.
- `data/index.json`: persisted deterministic vectors, 60 content-derived themes, capacity evidence, and recency-filtered co-authorship groups.
- `data/students.json`: 15 hand-written student posts.
- `lib/data.ts`: offline retrieval/ranking layer.
- `app/`: Next.js App Router screens for theme map, idea intake, matches, faculty feed, theme details, and group details.

Matching follows the requested profiles conceptually and always presents a cited paper, project, or theme as its explanation. The faculty availability toggle is explicit, browser-local demo state; activity is never described as willingness.

## Constraints

See `DECISIONS.md` for every ambiguity choice and known limitation. No runtime request depends on a Syracuse server.

## Semantic embeddings

Run `npm run index` to rebuild only the derived index without modifying the corpus or running the scraper. Indexing uses the local neural sentence-transformer `Xenova/all-MiniLM-L6-v2` (384 dimensions, quantized CPU inference, mean pooling and normalized vectors). No API key is required. The first run downloads weights from Hugging Face; subsequent runs reuse `data/cache/models`.

Publication text, researcher composites, and student posts use the same model. Long text is split into 180-word chunks whose vectors are length-weighted and normalized. Content-hash caches in `data/cache/neural-v1` include the model and preprocessing version. Unchanged inputs do not run inference again. Keep this directory between builds.

`POST /api/embed` accepts `{ "text": "research idea" }` and embeds student text server-side through the same model and disk cache. The matches screen uses this endpoint for faculty and student ranking. If inference is unavailable, the builder or endpoint prints `WARNING: NEURAL EMBEDDINGS UNAVAILABLE` and uses the retained TF-IDF space. Query fallback compares only lexical vectors and the UI displays the warning. Re-run indexing after restoring the model to replace a fallback index.

Spherical k-means derives themes from neural publication vectors. Co-author label propagation is preserved; group theme assignments use the neural researcher vectors. Theme labels come from cluster member text, not neural coordinate values.

After rebuilding the index, restart the application to load the new vectors. Run `npm run test:embeddings` to check semantic similarity, cache reuse, and explicit lexical fallback.
