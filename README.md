# The 061

AI-curated local news for Limerick, published as a static site on GitHub Pages.

A GitHub Actions workflow runs three times a day (early morning, with two backup runs). It collects Limerick news from the Limerick Post, Limerick Leader, Limerick Voice, Limerick GAA and Limerick Chamber RSS feeds (and NewsAPI, if configured), skipping non-news posts such as club notes and fixture lists and anything over 14 days old, removes duplicate stories, rewrites the ones with a Limerick connection using Google Gemini, and publishes the result. There is no server or database. A separate What's On page lists events from Limerick.ie (Limerick City and County Council): facts and a link only, no AI (`npm run events`).

## How it works

```
GitHub Actions (05:07, 09:07 and 13:07 UTC, or run manually)
  scrape  -> data/store.json        RSS + NewsAPI, new articles only
  dedupe  -> data/store.json        Gemini removes same-story duplicates
  rewrite -> data/store.json        Gemini rewrites up to MAX_DAILY_REWRITES new articles
  build   -> site/                  index page, one page per article, data/articles.json
  deploy  -> GitHub Pages
```

`data/store.json` is the only state. It is committed back to the repo by the workflow, and articles expire after 30 days. `site/` is generated and never committed.

## One-time setup

1. **Pages:** repo Settings > Pages > Source: **GitHub Actions**.
2. **Secrets:** Settings > Secrets and variables > Actions:
   - `GEMINI_API_KEY` (required) - from https://aistudio.google.com/app/apikey
   - `NEWSAPI_KEY` (optional)
3. Run **Actions > Update and Publish > Run workflow** once. The site appears at `https://<user>.github.io/<repo>/`.

## Workflow triggers

- **Schedule** - full pipeline at 05:07 UTC, with backup runs at 09:07 and 13:07. GitHub delays scheduled jobs (worst on the hour), so the backups make sure each day's edition appears; a backup only processes stories it hasn't seen.
- **Manual run** - same, with an optional *Clear rewritten articles first* checkbox. Use it after changing the rewrite prompt so old stories are regenerated.
- **Push to `master`** touching `public/` or the builder - rebuilds and redeploys only, with no scraping or AI calls.

## Local development

```bash
npm install
cp .env.example .env      # add GEMINI_API_KEY
npm run update            # scrape, dedupe, rewrite, build
npm run preview           # serve site/ locally
```

Individual steps: `npm run scrape`, `dedupe`, `rewrite`, `build`, `clear-rewrites`.

## Configuration

Environment variables (see `.env.example`; the workflow sets defaults for the non-secret ones):

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini API key |
| `NEWSAPI_KEY` | Optional NewsAPI key |
| `RSS_FEEDS` | Comma-separated feed URLs |
| `LIMERICK_KEYWORDS` | NewsAPI search terms |
| `MIN_ARTICLE_LENGTH` | Ignore feed items with shorter descriptions |
| `MAX_DAILY_REWRITES` | Max new articles examined per run (controls Gemini usage) |

## Project layout

```
scripts/
  scrape-news.js        collect articles into the store
  ai-deduplicate.js     drop same-story duplicates
  rewrite-articles.js   Limerick check + AI rewrite
  build-site.js         store -> site/ (HTML is escaped, URLs restricted to http/https)
  clear-rewrites.js     forget rewrites so they regenerate
  lib/store.js          file-backed store with 30-day expiry
public/                 index page, copied into site/
.github/workflows/publish.yml
```

## Note on content

Stories are AI rewrites of third-party reporting and are labelled as such, with a link to the original source on every page. Consider the source publishers' terms when choosing feeds.
