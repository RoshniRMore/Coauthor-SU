# Decisions and limitations

- 2026-09-20: The current corpus supersedes the initial synthetic fallback described below. OpenAlex institution `I70983195` supplies 1,512 Syracuse-affiliated researchers and 10,779 publications after cleaning 6,658 ingested author records. Experts@Syracuse routes present a Cloudflare browser challenge, which the scraper does not bypass; it transparently falls back to OpenAlex.
- 2026-09-20: Cleaning excludes works with more than 50 authors and requires at least three works per person, a publication since 2023 for this snapshot, a first or last authorship, and a plausible parsed name. The script's recency cutoff advances with the current UTC year minus three. This is filtered research coverage, not a verified faculty directory.
- 2026-09-20: OpenAlex awards are publication funder acknowledgements, not sponsored-project records. Retained records serve as acknowledgement provenance only; grant dates and active-funding claims were removed because the source does not substantiate them.
- 2026-09-19: The execution environment could not connect to `experts.syr.edu` or `surface.syr.edu`, and the browsing proxy reported both inaccessible. Per the final fallback in `plan.md`, the initial corpus is 300 unmistakably synthetic faculty records. Every synthetic person is marked `synthetic: true`, and the UI states the coverage honestly. This does **not** satisfy the real-data production claim; run `scripts/scrape-syracuse.mjs` in a network-enabled environment before deployment.
- Static JSON is used instead of SQLite so a clean clone needs no native database build.
- Deterministic hash vectors replace remote embedding APIs, preserving offline startup and reproducibility.
- Sixty themes are derived by topic-token bucketing; names come from corpus terms.
- Read-only faculty opt-in is stored in browser local storage and affects ranking immediately.
- The requested backup video cannot be recorded in this headless restricted environment; the app itself is fully offline after build.
- The `.git` directory is mounted read-only, so the required after-phase commits could not be created despite being attempted after Phase 1.
- The demo uses one representative faculty persona for the read-only faculty view; the toggle is browser-local because authentication is explicitly out of scope.
