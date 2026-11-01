# Backlog

Improvements, bugs and missing tests, in priority order. Agents pick from here; the owner decides what's next. Move an item to **Done** with the commit when it ships.

## 1. Republishing (needs the owner's decision first)
Checked 1 Nov 2026 against the rule in `CLAUDE.md` (short summaries in our own words, credit and link, no full articles or photos without a licence). The store had 131 published stories: 53 Limerick Post, 62 Limerick Leader, 13 Limerick Voice, 3 Limerick GAA.
- **Limerick Post terms forbid summaries.** limerickpost.ie/terms-and-conditions says you may not "produce summaries" or republish its content except for personal, non-commercial use without written permission. Options: ask the Post for permission, drop the feed, or show only its headline and a link.
- **Full rewrites are too long and too close.** The full-text prompt (`rewrite-articles.js`) sends up to 4,000 characters of the original and asks for 200–350 words with quotes that "read as original reporting, not a summary". That is a paraphrase of the whole article, not a short summary. The front page sends up to six paragraphs of it. Fix: one prompt for every story, a summary of two or three sentences in our own words, no quotes, no full text fetched.
- **Publishers' photos are shown without a licence.** 127 of 131 stories hotlink the outlet's photo (feed `media:content`, og:image, JSON-LD), and use it as the WhatsApp/Facebook share picture. Fix: drop outlet photos (keep our own share image), or keep them only for a source whose licence allows it.
- **We pretend to be a browser.** Feeds, article pages and images are fetched with a Chrome User-Agent, which gets round the Limerick Leader's block on scripts. Fix: an honest User-Agent naming The 061 with a contact link; if a source then refuses us, respect it.
- **AI signals.** The Limerick Post and Limerick GAA `robots.txt` say `Content-Signal: ai-train=no`. Gemini's free tier may use what we send to improve Google's models. Fix: a paid Gemini key (not used for training), or send only the feed's title and summary.
- **Limerick Leader terms not checked.** Its site returns 403 to scripts; the owner needs to read its terms in a browser. Its feed says "Iconic Media Group Ltd … All rights reserved".
- **NewsAPI.** Its free plan is for development only, and no NewsAPI stories are in the store. Remove it, along with `NEWSAPI_KEY`.

## 2. Bugs
- **Story pages show the date in UTC.** `articleHtml` in `build-site.js` formats the date without `timeZone: 'Europe/Dublin'` (the archive pages use it), so a story published at 00:30 Irish summer time shows the previous day on its own page.
- **"New stories every morning at 6am"** (masthead) is wrong: runs start at 05:07 UTC (05:07 in winter, 06:07 in summer), often late, with backups at 09:07 and 13:07.
- **A crash loses the run's work.** If any step in "Scrape, deduplicate, rewrite…" exits with an error, the commit step is skipped, so rewrites already paid for are thrown away and done again next run. Commit the store even when a later step fails, but still don't deploy.
- **Stories with no original link knock each other out.** `collectArticles` adds `undefined` to `seenLinks`, so only the first story with no link is published.
- **Dedupe keeps the newer of two new repeats** and marks the earlier, original report as the duplicate. Decide which one should win (probably the earliest, or the one with full text).

## 3. Pipeline and CI
- **Run the tests on every push**, not only before scheduled runs and on pushes that redeploy (a test-only job with no deploy).
- **Node 20 is past end of life** (April 2026). Move the workflow to Node 22 or 24; the tests pass on 20 and 24.
- **Health check:** open a GitHub issue (with the owner's agreement) when no new story has been published for two days, or a feed has failed for a day, as Ireland Now's `check-sources.js` does.

## 4. Missing tests
- `classify-sections.js` (the catch-up call: fills gaps, keeps what's set, survives a bad answer).
- The front page script in `public/index.html` (`chooseFront`, section grouping, GAA box); needs the script moved to its own file so it can be loaded in a test.
- `clear-rewrites.js`.

## Done
- `CLAUDE.md`, offline tests with fixtures, `npm test` gate in the workflow, builder and reviewer agents, push-needs-approval rule.
