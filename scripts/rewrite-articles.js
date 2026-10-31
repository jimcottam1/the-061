require('dotenv').config();
const store = require('./lib/store');
const { generate } = require('./lib/gemini');
const { SECTIONS: SECTION_NAMES, GUIDE: SECTION_GUIDE, RATING_GUIDE, normaliseSection, toRating } = require('./lib/sections');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

/**
 * Fetch full article content from URL using Cheerio for better extraction
 */
async function fetchFullArticle(url) {
    try {
        console.log(`   📄 Fetching full content from URL...`);

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000 // 10 second timeout
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Remove unwanted elements
        $('script, style, nav, header, footer, aside, .ads, .advertisement, .social-share').remove();

        // Try common article selectors
        let content = '';
        const selectors = [
            'article',
            '[role="main"]',
            '.article-content',
            '.post-content',
            '.entry-content',
            'main'
        ];

        for (const selector of selectors) {
            const element = $(selector);
            if (element.length > 0) {
                content = element.text();
                break;
            }
        }

        // Fallback: get all paragraphs
        if (!content || content.length < 200) {
            content = $('p').map((i, el) => $(el).text().trim()).get()
                .filter(p => p.length > 50)
                .join('\n\n');
        }

        // Clean up whitespace
        content = content
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n\n')
            .trim();

        if (content.length < 100) {
            console.log(`   ⚠️  Content too short (${content.length} chars), using description only`);
            return null;
        }

        console.log(`   ✓ Extracted ${content.length} characters`);
        return content.substring(0, 4000); // Limit to 4,000 chars for AI
    } catch (error) {
        console.error(`   ✗ Error fetching article: ${error.message}`);
        return null;
    }
}

/**
 * Check if article has Limerick connection using AI.
 * Returns true/false, or null if the check couldn't be made.
 */
async function hasLimerickConnection(article, fullContent) {
    const checkPrompt = `Does this article have ANY connection to Limerick, Ireland?

Consider connections to:
- Limerick city or county
- Shannon (town or airport nearby)
- Munster (province that includes Limerick)
- Irish national news that affects Limerick
- People from Limerick
- Sports teams from Limerick (e.g., Munster Rugby, Limerick GAA)
- Businesses or events in Limerick

Article: ${article.title}
Source: ${article.source}
Description: ${article.description.substring(0, 500)}
${fullContent ? 'Content: ' + fullContent.substring(0, 1000) : ''}

Respond with ONLY "YES" or "NO"`;

    try {
        const response = (await generate(checkPrompt)).trim().toUpperCase();
        return response.includes('YES');
    } catch (error) {
        console.error(`   ✗ Error checking Limerick connection: ${error.message}`);
        // Unknown, not YES: publishing an unchecked story is worse than waiting a day
        return null;
    }
}

/**
 * Prompt for a short brief, used when the full article couldn't be fetched (the Limerick Leader
 * blocks automated requests) and all we have is the title and the feed's one-line summary.
 */
function briefPrompt(originalArticle) {
    return `You are a professional journalist writing for "The 061", a Limerick news site named after the local phone code.

SOURCE ARTICLE (only the title and summary are available, not the full text):
Title: ${originalArticle.title}
Source: ${originalArticle.source}
Published: ${originalArticle.pubDate}
Summary: ${originalArticle.description}

TASK: Write a short news brief for The 061 that points readers to the original article.

REQUIREMENTS:
1. The HEADLINE states what the article is about, using only the facts given. Under 15 words.
   Different wording from the original.
2. The SUMMARY is one plain sentence giving what is known.
3. The STORY is ONE short paragraph of one or two sentences. Say only what the title and summary say.
   Do NOT pad it out, restate the same point in other words, or add background, praise or
   significance that isn't in the source. A short, honest brief is what is wanted.
4. Only use facts from the title and summary. Do not invent details, quotes or outcomes.
5. Be objective, balanced, and respectful.

${SECTION_GUIDE}

${RATING_GUIDE}

RESPOND IN JSON:
{
  "headline": "<headline>",
  "summary": "<one sentence>",
  "story": "<one or two sentences>",
  "localAngle": "<one sentence explaining the Limerick connection>",
  "section": "<one of: ${SECTION_NAMES.join(', ')}>",
  "importance": <1-5>,
  "positivity": <1-5>
}

Return ONLY valid JSON, no additional text.`;
}

/**
 * Rewrite article using AI. Without the full content it writes a short brief instead.
 */
async function rewriteArticle(originalArticle, fullContent) {
    const brief = !fullContent;
    console.log(`\n✍️  ${brief ? 'Writing brief' : 'Rewriting'}: ${originalArticle.title.substring(0, 60)}...`);

    const prompt = brief ? briefPrompt(originalArticle) : `You are a professional journalist writing for "The 061", a Limerick news site named after the local phone code.

SOURCE ARTICLE:
Title: ${originalArticle.title}
Source: ${originalArticle.source}
Published: ${originalArticle.pubDate}
Summary: ${originalArticle.description}

FULL CONTENT:
${fullContent}

TASK: Rewrite this as an original news story for The 061.

GET TO THE POINT. Readers want to know what happened in the first few seconds.

REQUIREMENTS:
1. The HEADLINE states the news itself: who did what, or what was decided. Use concrete facts
   (names, places, numbers, outcomes). Under 15 words. No vague phrases like "highlights dedication",
   "sparks debate" or "set to" when the actual outcome is known. Different wording from the original.
2. The SUMMARY is the TL;DR: one or two short, plain sentences giving the key facts - who, what,
   where, when and the outcome (e.g. the verdict, the sentence, the score, the amount, the decision).
   Someone who reads only the headline and summary should know what happened.
3. The STORY opens with the most important fact, then adds detail and context in order of importance.
   3-4 short paragraphs (200-350 words). Include quotes if available.
4. Focus on the Limerick angle - why this matters to local readers
5. Write in clear, plain journalistic style. Make it read as original reporting, not a summary of an article
6. Be objective, balanced, and respectful - avoid condescending or patronizing language
7. Treat all communities, individuals, and groups with dignity and respect
8. Report facts without editorial judgment about social class, income, or location
9. Use neutral, factual language when describing neighbourhoods and communities; no sensationalism
10. Keep a constructive tone where it fits, such as community responses or efforts to address a problem,
    but NEVER at the expense of stating plainly what happened. Do not pad stories with generic
    praise ("dedication", "resilience", "community spirit") that isn't in the source.
11. Only use facts from the source article. Do not invent details, quotes or outcomes.

${SECTION_GUIDE}

${RATING_GUIDE}

RESPOND IN JSON:
{
  "headline": "<headline that states the news>",
  "summary": "<1-2 sentence TL;DR with the key facts and outcome>",
  "story": "<your story in 3-4 paragraphs, separated by \\n\\n>",
  "localAngle": "<one sentence explaining the Limerick connection>",
  "section": "<one of: ${SECTION_NAMES.join(', ')}>",
  "importance": <1-5>,
  "positivity": <1-5>
}

Return ONLY valid JSON, no additional text.`;

    try {
        const text = await generate(prompt);

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in AI response');
        }

        const rewritten = JSON.parse(jsonMatch[0]);
        for (const field of ['headline', 'summary', 'story', 'localAngle']) {
            if (typeof rewritten[field] !== 'string' || !rewritten[field].trim()) {
                throw new Error(`AI response missing "${field}"`);
            }
        }
        // An unrecognised section is dropped; the catch-up step or the keyword fallback fills it in
        rewritten.section = normaliseSection(rewritten.section) || undefined;
        rewritten.importance = toRating(rewritten.importance) || undefined;
        rewritten.positivity = toRating(rewritten.positivity) || undefined;
        console.log(`   ✓ Generated ${rewritten.story.length} characters (${rewritten.section || 'no section'}, importance ${rewritten.importance ?? '?'}, positivity ${rewritten.positivity ?? '?'})`);

        return {
            ...rewritten,
            ...(brief && { brief: true }),
            originalTitle: originalArticle.title,
            originalSource: originalArticle.source,
            originalLink: originalArticle.link,
            publishedAt: originalArticle.pubDate,
            imageUrl: originalArticle.imageUrl,
            imageCredit: originalArticle.imageCredit,
            rewrittenAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('   ✗ Error rewriting:', error.message);
        return null;
    }
}

/**
 * Rewrite new articles.
 * `maxAttempts` caps how many articles we spend AI calls on in one run.
 */
async function rewriteArticles(maxAttempts = 10) {
    console.log('📝 AI Article Rewriter\n');
    console.log('='.repeat(50));

    try {
        const articles = store.getRecentArticles(100);

        if (articles.length === 0) {
            console.log('\n⚠️  No articles available. Run "npm run scrape" first.');
            return null;
        }

        console.log(`\n✓ ${articles.length} articles in store, rewriting up to ${maxAttempts} new ones\n`);

        let rewritten = 0;
        let skipped = 0;
        let failed = 0;
        let attempts = 0;

        for (const article of articles) {
            if (attempts >= maxAttempts) break;

            // Already rewritten, or already judged to have no Limerick connection
            if (store.getRewritten(article.id)) {
                continue;
            }

            attempts++;

            // Fetch full content from article URL
            const fullContent = await fetchFullArticle(article.link);

            console.log(`   🔍 Checking Limerick connection...`);
            const hasConnection = await hasLimerickConnection(article, fullContent);

            if (hasConnection === null) {
                // Nothing recorded, so the next run tries this article again
                console.log(`   ⏸ Leaving for the next run: ${article.title.substring(0, 60)}...`);
                failed++;
                continue;
            }

            if (!hasConnection) {
                console.log(`   ⊘ Skipping (no Limerick connection): ${article.title.substring(0, 60)}...`);
                // Remember the decision so tomorrow's run doesn't pay for the same check
                store.setRewritten(article.id, { skipped: true, rewrittenAt: new Date().toISOString() });
                skipped++;
                continue;
            }

            console.log(`   ✓ Has Limerick connection - proceeding with rewrite`);

            const rewrittenArticle = await rewriteArticle(article, fullContent);

            if (rewrittenArticle) {
                store.setRewritten(article.id, rewrittenArticle);
                rewritten++;
            } else {
                failed++;
            }

            // Save after each article so a later failure doesn't lose progress
            store.save();
        }

        store.save();

        console.log('\n' + '='.repeat(50));
        console.log('📊 Rewriting Summary:');
        console.log(`   Articles examined: ${attempts}`);
        console.log(`   Rewritten: ${rewritten}`);
        console.log(`   Skipped: ${skipped}`);
        console.log(`   Failed (retried next run): ${failed}`);
        console.log('='.repeat(50));

        return { rewritten, skipped, failed };
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    const count = parseInt(process.argv[2] || process.env.MAX_DAILY_REWRITES) || 10;

    rewriteArticles(count)
        .then(() => {
            console.log('\n🎉 Done!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Error:', error);
            process.exit(1);
        });
}

module.exports = { rewriteArticles, rewriteArticle };
