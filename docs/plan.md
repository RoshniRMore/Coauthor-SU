# plan.md

## Orange Coauthor — build plan

Read `vision.md` first for why this exists. This document is how it gets built.

---

## Stack

Next.js (App Router) + TypeScript + Tailwind. SQLite or a static JSON index — no external database service, no auth provider, nothing requiring a signup. Must run with `npm install && npm run dev` and nothing else.

---

## Phase 1 — Data foundation

Nothing else starts until this is real. The claim *every Syracuse professor is already in it* has to be true, not aspirational.

**Primary source: Experts@Syracuse** (`experts.syr.edu`), Elsevier Pure. Public faculty profiles, publication records, sponsored projects with funders and date ranges, departmental affiliation, collaboration links.

- Do not hardcode endpoints from assumption. Inspect the live site first: `robots.txt`, XML sitemaps, paginated person listings, per-organisation person lists, and any JSON the portal's own front end calls. Prefer a structured route over HTML parsing.
- Enumerate organisational units and walk each unit's person list — best route to full coverage, and it yields department affiliation.
- For each person, fetch profile, publications (paginate fully), and projects.
- Expect on the order of one to several thousand person records. Page until exhausted; never hardcode a count.

**Secondary source: SURFACE** (`surface.syr.edu`), Digital Commons, ~17,000 items. Check for OAI-PMH — if present it gives clean structured metadata far faster than scraping. Use it to enrich records with abstracts, which are the highest-signal text for embedding.

**Conduct:** respect `robots.txt`; rate limit to ~1 req/sec with jitter and exponential backoff on 429/5xx; descriptive User-Agent identifying this as a student project with a contact address; cache every response to disk so the scrape is resumable; public unauthenticated pages only; never contact anyone.

**Output:** `data/corpus.json`

```json
{
  "people": [{
    "id": "string",
    "name": "string",
    "title": "string",
    "departments": ["string"],
    "profile_url": "string",
    "publications": ["pub_id"],
    "projects": ["proj_id"],
    "coauthors": [{"id": "string", "count": 0, "latest_year": 2026}]
  }],
  "publications": [{
    "id": "string", "title": "string", "abstract": "string|null",
    "year": 2026, "venue": "string|null",
    "author_ids": ["string"], "url": "string"
  }],
  "projects": [{
    "id": "string", "title": "string", "description": "string|null",
    "start_date": "YYYY-MM-DD|null", "end_date": "YYYY-MM-DD|null",
    "funder": "string|null", "person_ids": ["string"]
  }]
}
```

**Gate:** do not start Phase 2 until `corpus.json` exists and contains people with publications attached.

---

## Phase 2 — Understanding

**Embeddings.** Embed each publication (title + abstract), each project (title + description), and a composite document per person weighted toward the last three years. Persist vectors to disk — nothing re-embeds on restart.

**Themes.** Cluster publication and project vectors into **40–80 themes** university-wide. Specific enough to be meaningful, few enough to render as a map. For each cluster generate: a human-readable name (4–8 words, no jargon soup), a one-sentence description, and the 3–5 most representative publications. Name themes from actual contents, never from a predetermined list. Compute per theme: active faculty count, total publications, publications in the last 24 months, count of currently-active funded projects.

**Groups.** Build a co-authorship graph from `people[].coauthors` and run community detection. Keep a cluster as a research group only if ≥2 members, ≥2 co-authored works, and at least one in the last 3 years — one paper from 2016 is not a lab. Name each group after its most-published member plus its dominant theme. Attach any active funded project shared by members.

**Capacity signals** per person, stored for display as evidence:
- `active_project` — has a sponsored project with a future end date
- `recent_output` — publications in the last 24 months
- `theme_recency` — most recent year publishing in a given theme
- `opted_in` — boolean, default false, set only by the faculty toggle

Never display that a professor "wants a student" unless `opted_in` is true. Show the evidence instead.

---

## Phase 3 — Matching

One retrieval function, three ranking profiles.

**Student → faculty**
`0.45·theme_fit + 0.20·direct_similarity + 0.15·active_project + 0.10·recent_output + 0.10·opted_in`

**Student → group**
`0.45·theme_fit + 0.25·cohesion + 0.20·recency + 0.10·active_project`
cohesion = co-publication density; recency = share of output in the last 3 years.

**Student → student**
`0.55·theme_fit + 0.45·complementarity`
Complementarity **rewards difference** in declared skills and coursework while requiring theme overlap. Two students who both only want frontend must not rank highly together.

Every match carries a generated one-sentence explanation naming a specific paper, project, or theme. A match with no reason is a bug. Cache explanations; never regenerate on page load.

---

## Phase 4 — The product

**Theme map (home).** The research landscape as the hero — themes explorable, sized by activity. Clicking a theme shows its faculty, groups, and defining papers. Usable with zero input.

**Post an idea.** One free-text field plus light structured inputs: courses taken, hours per week, timeline. On submit, show where the idea landed in the theme space *before* showing matches.

**Matches.** Three tabs — faculty, groups, students. Each card carries the explanation, evidence chips (active grant through *year*; *n* papers since *year*), and a link to the real source page on experts.syr.edu.

**Faculty view.** Ranked feed of student posts relevant to that professor's themes, plus the single "I'm open to students this semester" toggle. Read-only demo mode, no real auth.

**Group detail.** The co-authorship cluster as a small network, with shared project and recent output.

**Quality floor:** 375px phone width, real empty/loading/error states, visible keyboard focus, `prefers-reduced-motion` respected, no dead links, no console errors. Never a raw stack trace or an infinite spinner.

---

## Phase 5 — Readiness

Hand-write **15 realistic student posts** across several departments, varying from vague to precise, loaded at startup. Student-to-student is worthless against an empty pool and the faculty view must never open empty.

Surface real data coverage honestly in the footer. Record a backup demo video. Never let the live demo depend on a syr.edu server responding.

---

## Design direction

Subject: academic research discovery. Audience: undergraduates locked out of research, and faculty drowning in email. It should feel like a well-made scholarly instrument — precise, dense with real information, quietly confident. Not a startup landing page.

**Palette** — cool ink-on-paper, Syracuse orange as a scarce signal rather than a theme colour:
- `#F6F7F8` paper (cool off-white, not cream)
- `#16181D` ink
- `#5B636E` slate — secondary text and chrome
- `#D9DDE2` rule — hairlines, dividers
- `#F76900` orange — reserved for match strength and the single primary action per screen. More than twice on a screen, remove one.

**Type** — two families, separated jobs:
- `Inter Tight` for all interface text, on a deliberate scale.
- `Newsreader` (serif) **only** for real publication and project titles quoted from the corpus, so the serif itself means "this is actual scholarship." Never for headlines or labels.

**Principles.** The hero is the theme map, not a headline over a gradient. Evidence is the ornament — grant dates, paper counts, years are the visual texture; don't decorate on top of them. Spend all boldness on match-strength visualisation. Copy is active and plain: buttons say what happens, empty states say what to do next, errors say what broke.

**Avoid** — all-caps eyebrow labels, middle-dot meta strings, identical rounded cards with the same soft shadow, arrows appended to button text, fade-up animations on every section, gradient washes. These read as templated.

---

## Fallbacks

- **Portal rate-limits or blocks:** slow down, resume from cache, proceed with the captured subset. Partial real data beats none — record actual coverage and surface it in the app.
- **No structured route:** fall back to HTML parsing with resilient selectors.
- **Publications lack abstracts:** embed title plus venue; enrich from SURFACE where possible.
- **Scraping fully unavailable:** generate ~300 synthetic faculty across realistic Syracuse departments so the pipeline and app stay demonstrable, marked unmistakably as synthetic. Last resort only.
- **Incoherent themes:** reduce dimensionality before clustering or lower the theme count, retry once. Never ship unnamed clusters.

---

## Cut order under time pressure

Cut in this order: student-to-student matching, then group detail, then theme map interactivity. **Student-to-faculty matching with explanations is the floor and ships regardless.**

---

## Definition of done

1. `data/corpus.json` holds real Syracuse faculty with publications and projects; count printed.
2. Themes generated, named, countable.
3. Groups derived from co-authorship with the recency filter applied.
4. All three match types return ranked results with per-match explanations.
5. App starts from a clean clone with `npm install && npm run dev`.
6. All five screens render at 375px without horizontal scroll.
7. 15 seeded student posts present.
8. Faculty opt-in toggle works and changes ranking.
9. `README.md` documents setup, data provenance, architecture.
10. `DECISIONS.md` records every choice made under ambiguity and every known limitation.

---

## Out of scope

Authentication, real email sending, notifications, chat, admin panels, analytics, payments, native apps, Docker, CI, test suites beyond a smoke test, dark mode. Anything not in Phase 4 is out of scope. Do not expand surface area.
