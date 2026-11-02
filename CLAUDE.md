# The 061: notes for agents

A static local-news site for Limerick. GitHub Actions (`.github/workflows/publish.yml`) runs the pipeline three times a day (05:07, 09:07, 13:07 UTC), commits `data/store.json` back to `master` with a `[skip ci]` message, and deploys `site/` to GitHub Pages at https://jimcottam1.github.io/the-061/. There is no server or database. See README.md for setup.

## The pipeline
Each step reads and writes `data/store.json` through `scripts/lib/store.js` (30-day expiry, atomic save).
1. **scrape** (`scrape-news.js`): RSS feeds in `RSS_FEEDS` (and NewsAPI if `NEWSAPI_KEY` is set). Skips non-news posts (`NOT_NEWS`: club notes, results/fixtures lists, lotto, sponsor posts), short descriptions and anything over 14 days old; drops repeats by id, link and exact title.
2. **dedupe** (`ai-deduplicate.js`): Gemini compares each new article with the stories already kept; a duplicate is marked `skipped` with `duplicateOf`, not deleted (so tomorrow's scrape doesn't re-check it).
3. **rewrite** (`rewrite-articles.js`): Gemini checks for a Limerick connection, then rewrites. If the full text can't be fetched it writes a short **brief** from the title and summary. A failed check leaves no record, so the next run retries.
4. **sections** (`classify-sections.js`): catch-up call for stories missing a section, importance or positivity.
5. **images** (`fetch-images.js`): the feed's photo, else the article page's og:image / twitter:image / JSON-LD thumbnail (not share cards).
6. **gaa** (`fetch-gaa-fixtures.js`): Limerick GAA results and fixtures posts into `data/gaa-fixtures.json` for the Sport box. Never fails the run.
6b. **events** (`fetch-events.js`): What's On. Reads limerick.ie's events RSS feed (the only source; honest `The061/1.0` User-Agent), drops `PRIVATE:`/`Test` items and anything outside `/discover/whats-on/`, and fetches each new event's page for JSON-LD dates plus Location and Price(s). Facts only (title, dates, place, price, link): never copy its descriptions or images. Also drops `CANCELLED` titles. Caches by guid in `data/events.json` with `checkedAt`: a page is read again when more than 3 days old, within 2 days of the event's start, or when the feed title changed (so postponements move); title always comes from the feed. At most 40 page fetches a run, about 1 s apart. `past` (finished, recently checked) and `failed` (retry after 24 h) are the fetcher's notes, stripped from the published copy. Never fails the run; a bad feed keeps the last file. The date, grouping, wording and weekend-box logic is one file, `public/events-core.js`, used by the builder, `whats-on.html` (server-built fallback, regrouped in the browser) and the front page box (loaded separately from the stories). The feed only reaches about 12 days ahead; don't page it with a `?query` (robots.txt).
7. **build** (`build-site.js`): store to `site/`: front page data (`data/articles.json`, last 7 days, at least 12 stories), one page per story, section archives, 404.
8. **deploy**: GitHub Pages. If master moved during a run, `merge-store.js` merges the store story by story before the commit.

The front end is `public/index.html` (one page, inline script that renders `data/articles.json`) and `public/styles.css`. The "Limerick now" strip reads Ireland Now's data from `/ireland-now/data/`, so it only shows on the live domain.

## Commands
- `npm test`: runs `test/*.test.js` (Node's built-in runner, no network, no Gemini, no NewsAPI). Must pass before any commit. CI runs it before anything is scraped or published.
- `npm run build`: rebuilds `site/` from the committed store, with no network or AI calls. This is the safe way to preview.
- `npm run preview`: serves `site/` at http://localhost:3000.
- `npm run update`: the whole pipeline. It calls Gemini (costs quota) and writes `data/store.json`, so don't run it unless asked; never commit a store produced locally.
- `npm run clear-rewrites`: forget all rewrites so they regenerate. Ask first.

## How we work
- **Test first.** A changed parser, filter, prompt handler or page needs a test in `test/`, with a small saved sample in `test/fixtures/` where it reads outside data. Use the helpers in `test/helpers.js`: `useStore`, `loadScript`, `mockFetch`, `mockGemini`, `freezeClock`. Tests must not depend on today's date (freeze the clock).
- **Check a test catches the bug.** After writing one, break the code on purpose and confirm `npm test` fails, then put the code back.
- **Never push without asking the owner.** Pushing to `master` redeploys the live site. The workflow's own `chore: update article store [skip ci]` commits are separate and are not ours to make. Pull before branching: the store moves several times a day.
- **Look at the real page.** For anything visible, run `npm run build`, serve `site/`, and check it in a browser at desktop width and at phone width (390 px), with no console errors.
- Ask the owner before adding a source, a user-visible feature, or words readers will see; suggest a recommended option.

## Rules
- **Only permitted sources.** Check `robots.txt` and the site's terms before adding or keeping a source. Don't get around blocks, CAPTCHAs or bot checks (including by pretending to be a browser), and don't use keys taken from another site's page.
- **What we may republish from other outlets:** short summaries in our own words, with a clear credit and a link to the original. Never full articles, close paraphrases of whole articles, long quotes, or the outlet's photos, unless the source's licence or written permission allows it. Every story page and listing credits the outlet and links to the original.
- **Never call Gemini or NewsAPI in tests.** `test/helpers.js` replaces both and blanks the keys; a test that reaches them fails.
- **API keys only as GitHub secrets** (`GEMINI_API_KEY`, `NEWSAPI_KEY`). Never print them, put them in the page, a fixture, a log or a commit.
- A failed source or AI call must not publish empty or wrong data: leave the store as it was for that story so the next run retries.
- Escape every value from a feed or from Gemini (`escapeHtml` in the builder, `esc` in the page) and only allow http(s) URLs into `href`/`src` (`safeUrl`).

## Writing
Plain British/Irish English, short sentences. Words readers will see need the owner's agreement.

## Gotchas
- `data/store.json` is rewritten by CI several times a day; rebase or pull before committing, and never hand-edit it in a branch that will sit for a while.
- Editing files through shell heredocs mangles `\b`, `\d` and backticks; use the Edit tool for regex-heavy code.
- Git Bash rewrites arguments starting with `/` into Windows paths; set `MSYS_NO_PATHCONV=1` when passing such text.
- The Limerick Leader returns 403 to non-browser requests for article pages, which is why its stories are briefs.
- `SECTIONS` in `scripts/lib/sections.js` must match `SECTION_ORDER` in `public/index.html`.
