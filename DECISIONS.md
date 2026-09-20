# Decisions and limitations

- 2026-09-19: The execution environment could not connect to `experts.syr.edu` or `surface.syr.edu`, and the browsing proxy reported both inaccessible. Per the final fallback in `plan.md`, the initial corpus is 300 unmistakably synthetic faculty records. Every synthetic person is marked `synthetic: true`, and the UI states the coverage honestly. This does **not** satisfy the real-data production claim; run `scripts/scrape-syracuse.mjs` in a network-enabled environment before deployment.
- Static JSON is used instead of SQLite so a clean clone needs no native database build.
- Deterministic hash vectors replace remote embedding APIs, preserving offline startup and reproducibility.
- Sixty themes are derived by topic-token bucketing; names come from corpus terms.
- Read-only faculty opt-in is stored in browser local storage and affects ranking immediately.
- The requested backup video cannot be recorded in this headless restricted environment; the app itself is fully offline after build.
- The `.git` directory is mounted read-only, so the required after-phase commits could not be created despite being attempted after Phase 1.
- The demo uses one representative faculty persona for the read-only faculty view; the toggle is browser-local because authentication is explicitly out of scope.
