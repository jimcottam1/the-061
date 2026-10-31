require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const { normaliseSection } = require('./lib/sections');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITE_DIR = process.env.SITE_DIR || path.join(ROOT, 'site');
// Every stored story (30 days) gets a page and an archive entry; the front page shows the last week,
// topped up with the newest stories if a quiet week leaves it thin
const MAX_ARTICLES = 500;
const FRONT_PAGE_DAYS = 7;
const FRONT_PAGE_MIN = 12;

// GitHub Pages lets browsers cache files for 10 minutes, so a returning reader could get a new page
// with the old stylesheet. Versioning the stylesheet URL by its content makes every change load fresh.
const STYLE_VERSION = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'))).digest('hex').slice(0, 8);

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/** Only allow http(s) URLs into href/src attributes. */
function safeUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

/** Filesystem/URL safe name: readable prefix + hash, so long or similar IDs never collide or overflow. */
function slugFor(id) {
    const readable = id.replace(/^https?:\/\//i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80);
    const hash = crypto.createHash('sha1').update(id).digest('hex').slice(0, 8);
    return `${readable}-${hash}`;
}

/** Publishable articles: rewritten, with a Limerick angle, de-duplicated by link and headline. */
function collectArticles() {
    const seenLinks = new Set();
    const seenHeadlines = new Set();
    const articles = [];

    for (const [id, article] of store.listRewritten()) {
        if (article.skipped || !article.localAngle || !article.story || !article.headline) continue;

        const link = article.originalLink?.toLowerCase().trim();
        const headline = article.headline.toLowerCase().trim();
        if (seenLinks.has(link) || seenHeadlines.has(headline)) continue;
        seenLinks.add(link);
        seenHeadlines.add(headline);

        articles.push({
            ...article,
            id,
            slug: slugFor(id),
            section: sectionFor(article),
            originalSource: SOURCE_NAMES[article.originalSource] || article.originalSource,
            sourceHome: SOURCE_HOMEPAGES[article.originalSource]
        });
        if (articles.length >= MAX_ARTICLES) break;
    }

    return articles;
}

// Public address of the site, for link previews (they need absolute URLs)
const SITE_URL = (process.env.SITE_URL || 'https://jimcottam1.github.io/the-061/').replace(/\/?$/, '/');
const SHARE_IMAGE = `${SITE_URL}share.png`;

/** Open Graph and Twitter tags, so shared links show a headline, summary and picture in WhatsApp etc. */
function shareTags({ title, description, url, image, type = 'website' }) {
    const tags = {
        'og:site_name': 'The 061',
        'og:type': type,
        'og:title': title,
        'og:description': description,
        'og:url': url,
        'og:image': image || SHARE_IMAGE,
        'og:locale': 'en_IE'
    };
    return Object.entries(tags).map(([p, c]) => `<meta property="${p}" content="${escapeHtml(c)}">`).join('\n    ')
        + `\n    <meta name="twitter:card" content="summary_large_image">`
        + `\n    <link rel="canonical" href="${escapeHtml(url)}">`;
}

/**
 * Share buttons for a story. "Share" uses the phone's own share menu where the browser supports it
 * (shown by SHARE_SCRIPT); the rest are plain links that work everywhere.
 */
function shareBar(article, label) {
    const url = `${SITE_URL}articles/${article.slug}.html`;
    const title = article.headline;
    const enc = encodeURIComponent;
    const links = [
        ['WhatsApp', `https://wa.me/?text=${enc(`${title} ${url}`)}`],
        ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
        ['X', `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`],
        ['Email', `mailto:?subject=${enc(title)}&body=${enc(`${title}\n\n${url}`)}`]
    ];
    return `<div class="share-bar"${label ? ' data-labelled' : ''}>
                ${label ? `<span class="share-label">${escapeHtml(label)}</span>` : ''}
                <button type="button" class="share-btn share-native" data-share-url="${escapeHtml(url)}" data-share-title="${escapeHtml(title)}" hidden>Share&hellip;</button>
                ${links.map(([name, href]) => `<a class="share-btn" href="${escapeHtml(href)}"${name === 'Email' ? '' : ' target="_blank" rel="noopener"'}>${name}</a>`).join('')}
                <button type="button" class="share-btn" data-copy-url="${escapeHtml(url)}">Copy link</button>
            </div>`;
}

// Shows the native "Share…" button where supported, and makes "Copy link" work
const SHARE_SCRIPT = `
document.querySelectorAll('.share-native').forEach(function (b) {
    if (!navigator.share) return;
    b.hidden = false;
    b.addEventListener('click', function () {
        navigator.share({ title: b.dataset.shareTitle, url: b.dataset.shareUrl }).catch(function () {});
    });
});
document.querySelectorAll('[data-copy-url]').forEach(function (b) {
    b.addEventListener('click', function () {
        var done = function (text) { b.textContent = text; setTimeout(function () { b.textContent = 'Copy link'; }, 2000); };
        if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copyUrl).then(function () { done('Link copied'); }, function () { done('Copy failed'); });
        else done('Copy failed');
    });
});`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;700&family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">`;

/** Feed names come from the feed hostname; show them the way the papers write them. */
const SOURCE_NAMES = {
    limerickpost: 'Limerick Post',
    limerickleader: 'Limerick Leader',
    ilovelimerick: 'I Love Limerick',
    limerickvoice: 'Limerick Voice',
    limerickgaa: 'Limerick GAA',
    limerickchamber: 'Limerick Chamber'
};

/** Publishers' homepages, for the sources list in the front page footer. */
const SOURCE_HOMEPAGES = {
    limerickpost: 'https://www.limerickpost.ie/',
    limerickleader: 'https://www.limerickleader.ie/',
    ilovelimerick: 'https://www.ilovelimerick.ie/',
    limerickvoice: 'https://limerickvoice.com/',
    limerickgaa: 'https://www.limerickgaa.ie/',
    limerickchamber: 'https://www.limerickchamber.ie/'
};

/** Fallback section from keywords (Gemini normally chooses); the headline decides if it can, then the story. */
const SECTIONS = [
    // Weather warnings mention businesses, travel and so on, so catch them before Business does
    ['News', /\b(storm|met [eé]ireann|status (yellow|orange|red)|weather warning)\b/i],
    ['Sport', /\b(munster|gaa|hurl\w*|camogie|rugby|soccer|football\w*|treaty united|match|fixture|league|championship|kick-?off|squad|cup)\b/i],
    ['Council', /\b(council\w*|councillors?|planning|housing|elected members|local authority)\b/i],
    ['Business', /\b(business\w*|property|house prices|jobs?|employ\w*|company|companies|investment|economy|retail\w*|chamber)\b/i],
    ['Arts & Culture', /\b(festival|film|cinema|exhibition|gallery|artists?|music|theatre|concert|curators?|book)\b/i],
    ['Courts', /\b(court|garda\w*|judge|charged|sentenced)\b/i]
];

function sectionFor(article) {
    // Gemini's choice when it made one; the keyword rules below are only the fallback
    const chosen = normaliseSection(article.section);
    if (chosen) return chosen;
    for (const text of [`${article.headline} ${article.summary || article.subheadline || ''}`, article.story]) {
        const match = SECTIONS.find(([, pattern]) => pattern.test(text));
        if (match) return match[0];
    }
    return 'News';
}

/** Anchor for a section on the front page; must match sectionId() in public/index.html. */
function sectionId(name) {
    return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function paragraphsOf(story) {
    return story.split('\n\n').map(p => p.trim()).filter(Boolean);
}

/** "Photo: Adrian Butler / Limerick Leader", or just the source when the feed gives no usable credit. */
function photoCredit(article) {
    const credit = (article.imageCredit || '').trim();
    const useful = credit.length > 2 && credit.toLowerCase() !== article.originalSource.toLowerCase();
    return `Photo: ${useful ? `${credit} / ` : ''}${article.originalSource}`;
}

function articleHtml(article) {
    const published = new Date(article.publishedAt);
    const dateStr = Number.isNaN(published.getTime())
        ? ''
        : published.toLocaleDateString('en-IE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const image = safeUrl(article.imageUrl);
    const original = safeUrl(article.originalLink);
    const paragraphs = paragraphsOf(article.story).map(p => `<p>${escapeHtml(p)}</p>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(article.headline)} - The 061</title>
    <meta name="description" content="${escapeHtml(article.summary || article.subheadline || article.headline)}">
    ${shareTags({
        title: article.headline,
        description: article.summary || article.subheadline || article.headline,
        url: `${SITE_URL}articles/${article.slug}.html`,
        image: image,
        type: 'article'
    })}
    ${FONTS}
    <link rel="stylesheet" href="../styles.css?v=${STYLE_VERSION}">
</head>
<body>
    <div class="paper">
        <header class="masthead-compact">
            <div class="masthead">
                <p class="masthead-title"><a href="../index.html"><span class="mast-the">The</span>061</a></p>
            </div>
            <div class="dateline">
                <a href="../index.html">&larr; Front page</a>
                <span class="motto">All the news of the Treaty City</span>
                <a href="../sections/${sectionId(article.section)}.html">${escapeHtml(article.section)}</a>
            </div>
        </header>

        <main class="article">
            <span class="kicker">${escapeHtml(article.section)}</span>
            <h1 class="headline">${escapeHtml(article.headline)}</h1>
            ${article.summary
                ? `<p class="tldr"><span class="tldr-label">In brief</span> ${escapeHtml(article.summary)}</p>`
                : article.subheadline ? `<p class="deck">${escapeHtml(article.subheadline)}</p>` : ''}
            <p class="byline">The 061 &middot; from reporting by ${escapeHtml(article.originalSource)}${dateStr ? ` &middot; ${escapeHtml(dateStr)}` : ''}</p>
            ${shareBar(article)}

            ${image ? `<figure class="photo photo-article">
                <img src="${escapeHtml(image)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()">
                <figcaption>${escapeHtml(photoCredit(article))}</figcaption>
            </figure>` : ''}

            <div class="body-text drop-cap">
${paragraphs}
            </div>

            ${article.brief && original ? `<p class="read-full"><a href="${escapeHtml(original)}" target="_blank" rel="noopener noreferrer">Read the full story at ${escapeHtml(article.originalSource)} &rarr;</a></p>` : ''}

            <section class="boxed">
                <h2>The Limerick connection</h2>
                <p>${escapeHtml(article.localAngle)}</p>
            </section>

            ${shareBar(article, 'Share this story')}

            <section class="source-note">
                <p>${article.brief
                    ? 'This brief was written by AI for The 061 from the headline and summary of'
                    : 'This story was rewritten by AI for The 061 from original reporting by'} <strong>${escapeHtml(article.originalSource)}</strong>${article.originalTitle ? `, &ldquo;${escapeHtml(article.originalTitle)}&rdquo;` : ''}.</p>
                ${original ? `<p><a href="${escapeHtml(original)}" target="_blank" rel="noopener noreferrer">Read the original article &rarr;</a></p>` : ''}
            </section>
        </main>

        <footer class="colophon">
            <span class="masthead-small"><span class="mast-the">The</span>061</span>
            Stories are AI rewrites of local reporting &middot; each links to its original source
        </footer>
    </div>
    <script>${SHARE_SCRIPT}</script>
</body>
</html>
`;
}

function longDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? 'Undated'
        : d.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Dublin' });
}

function archiveEntryHtml(article, showSection) {
    const image = safeUrl(article.imageUrl);
    const original = safeUrl(article.originalLink);
    const href = `../articles/${article.slug}.html`;
    return `
            <article class="archive-entry${image ? '' : ' no-photo'}">
                ${image ? `<a class="archive-thumb" href="${href}"><img src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></a>` : ''}
                <div>
                    ${showSection ? `<span class="kicker">${escapeHtml(article.section)}</span>` : ''}
                    <h3 class="headline"><a href="${href}">${escapeHtml(article.headline)}</a></h3>
                    ${article.summary || article.subheadline ? `<p class="brief-summary">${escapeHtml(article.summary || article.subheadline)}</p>` : ''}
                    <div class="story-foot">
                        <a class="continued" href="${href}">Read more &rarr;</a>
                        <span class="original">Original story: ${original
                            ? `<a class="source-link" href="${escapeHtml(original)}" target="_blank" rel="noopener">${escapeHtml(article.originalSource)}</a>`
                            : escapeHtml(article.originalSource)}</span>
                    </div>
                </div>
            </article>`;
}

/**
 * An archive page: every stored story in a section (or all of them), newest first under date headings.
 * `sections` is the list of all section archives, for the links along the top.
 */
function archiveHtml(title, currentId, articles, sections) {
    const showSection = currentId === 'all';
    const byDay = new Map();
    for (const article of articles) {
        const day = longDate(article.publishedAt);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(article);
    }

    const nav = [{ id: 'all', name: 'All stories' }, ...sections]
        .map(s => s.id === currentId
            ? `<span aria-current="page">${escapeHtml(s.name)}</span>`
            : `<a href="${s.id}.html">${escapeHtml(s.name)}</a>`)
        .join('');

    const days = [...byDay].map(([day, stories]) => `
        <section class="archive-day">
            <h2 class="archive-date">${escapeHtml(day)}</h2>
            ${stories.map(a => archiveEntryHtml(a, showSection)).join('')}
        </section>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} - The 061</title>
    <meta name="description" content="${escapeHtml(title)} from the last 30 days in The 061, local news for Limerick.">
    ${shareTags({
        title: `${title} - The 061`,
        description: `${title} from the last 30 days in The 061, local news for Limerick.`,
        url: `${SITE_URL}sections/${currentId}.html`
    })}
    ${FONTS}
    <link rel="stylesheet" href="../styles.css?v=${STYLE_VERSION}">
</head>
<body>
    <div class="paper">
        <header class="masthead-compact">
            <div class="masthead">
                <p class="masthead-title"><a href="../index.html"><span class="mast-the">The</span>061</a></p>
            </div>
            <div class="dateline">
                <a href="../index.html">&larr; Front page</a>
                <span class="motto">All the news of the Treaty City</span>
                <span>Archive</span>
            </div>
            <nav class="section-nav" aria-label="Archive sections">${nav}</nav>
        </header>

        <main class="archive">
            <header class="section-head">
                <h1>${escapeHtml(title)}</h1>
                <span>${articles.length} ${articles.length === 1 ? 'story' : 'stories'} &middot; last 30 days</span>
            </header>
            ${days}
        </main>

        <footer class="colophon">
            <span class="masthead-small"><span class="mast-the">The</span>061</span>
            Stories are kept for 30 days &middot; each links to its original source
        </footer>
    </div>
</body>
</html>
`;
}

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Not found - The 061</title>
    ${FONTS}
    <link rel="stylesheet" id="styles" href="styles.css?v=${STYLE_VERSION}">
</head>
<body>
    <div class="paper">
        <header class="masthead-compact">
            <div class="masthead"><p class="masthead-title"><a class="home" href="./"><span class="mast-the">The</span>061</a></p></div>
            <div class="dateline"><span>Stop press</span><span class="motto">All the news of the Treaty City</span><span>Page not found</span></div>
        </header>
        <p class="notice">This story may have expired or been removed.<br><br><a class="home continued" href="./">Back to the front page &rarr;</a></p>
    </div>
<script>
// Works for both a project site (/the-061/...) and a root site
var m = location.pathname.match(/^(.*\\/)articles\\//) || location.pathname.match(/^(\\/[^/]+\\/)/);
var base = m ? m[1] : '/';
document.getElementById('styles').href = base + 'styles.css?v=${STYLE_VERSION}';
document.querySelectorAll('.home').forEach(function (a) { a.href = base; });
</script>
</body></html>
`;

function buildSite() {
    console.log('🏗️  Building static site...\n');

    fs.rmSync(SITE_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(SITE_DIR, 'articles'), { recursive: true });
    fs.mkdirSync(path.join(SITE_DIR, 'data'), { recursive: true });

    fs.cpSync(PUBLIC_DIR, SITE_DIR, { recursive: true });
    const indexPath = path.join(SITE_DIR, 'index.html');
    const frontTags = shareTags({
        title: 'The 061 - Local News for Limerick',
        description: 'All the news of the Treaty City: local news from Limerick city and county, updated every morning.',
        url: SITE_URL
    });
    fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8')
        .replace('href="styles.css"', `href="styles.css?v=${STYLE_VERSION}"`)
        .replace('</title>', `</title>\n    ${frontTags}`));

    const articles = collectArticles();

    for (const article of articles) {
        fs.writeFileSync(path.join(SITE_DIR, 'articles', `${article.slug}.html`), articleHtml(article));
    }

    // Section archives: every stored story, grouped by section, plus one page with everything
    fs.mkdirSync(path.join(SITE_DIR, 'sections'), { recursive: true });
    const sectionNames = [...new Set(articles.map(a => a.section))].sort((a, b) => a.localeCompare(b));
    const sections = sectionNames.map(name => ({ id: sectionId(name), name, count: articles.filter(a => a.section === name).length }));
    fs.writeFileSync(path.join(SITE_DIR, 'sections', 'all.html'), archiveHtml('All stories', 'all', articles, sections));
    for (const { id, name } of sections) {
        fs.writeFileSync(path.join(SITE_DIR, 'sections', `${id}.html`), archiveHtml(name, id, articles.filter(a => a.section === name), sections));
    }

    // The front page shows the last week (articles are newest first), topped up if that's too few
    const builtAt = Date.now();
    const recent = articles.filter(a => builtAt - new Date(a.publishedAt).getTime() <= FRONT_PAGE_DAYS * 86400000);
    const frontPage = recent.length >= FRONT_PAGE_MIN ? recent : articles.slice(0, FRONT_PAGE_MIN);

    // The front page only needs list fields, plus the opening paragraphs for whichever story leads.
    const listing = frontPage.map(article => {
        const { slug, section, headline, story, originalSource, publishedAt } = article;
        const paragraphs = paragraphsOf(story);
        const first = paragraphs[0] || '';
        const imageUrl = safeUrl(article.imageUrl);
        return {
            slug, section, headline, originalSource, publishedAt,
            // Gemini's ratings, used to pick the lead and Top stories (missing on stories not yet rated)
            importance: article.importance || null,
            // Only the headline and summary were available, so it shouldn't lead the paper
            ...(article.brief && { brief: true }),
            positivity: article.positivity || null,
            originalLink: safeUrl(article.originalLink),
            sourceHome: safeUrl(article.sourceHome),
            ...(imageUrl && { imageUrl, photoCredit: photoCredit(article) }),
            // The rewrite's TL;DR; stories written before it existed fall back to their opening paragraph
            summary: article.summary || (first.length > 200 ? first.substring(0, 200) + '...' : first),
            lead: paragraphs.slice(0, 6)
        };
    });
    fs.writeFileSync(
        path.join(SITE_DIR, 'data', 'articles.json'),
        JSON.stringify({
            generatedAt: new Date(builtAt).toISOString(),
            count: listing.length,
            archiveCount: articles.length,
            sections: sections.map(({ id, name, count }) => ({ id, name, count })),
            articles: listing
        })
    );

    // Limerick GAA club results and fixtures, for the box in the Sport section (see fetch-gaa-fixtures.js)
    const gaaFixtures = path.join(ROOT, 'data', 'gaa-fixtures.json');
    if (fs.existsSync(gaaFixtures)) fs.copyFileSync(gaaFixtures, path.join(SITE_DIR, 'data', 'gaa-fixtures.json'));

    fs.writeFileSync(path.join(SITE_DIR, '404.html'), NOT_FOUND_HTML);
    fs.writeFileSync(path.join(SITE_DIR, '.nojekyll'), '');

    console.log(`✅ Built ${articles.length} article pages, ${sections.length + 1} archive pages and a front page of ${listing.length} into ${SITE_DIR}`);
    return { count: articles.length };
}

if (require.main === module) {
    buildSite();
}

module.exports = { buildSite, escapeHtml, safeUrl, slugFor };
