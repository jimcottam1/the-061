const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { useStore, loadScript, freezeClock, tempDir, quiet } = require('./helpers');

const NOW = '2026-11-01T12:00:00.000Z';
const hoursAgo = h => new Date(Date.parse(NOW) - h * 3600000).toISOString();

const story = (n, extra = {}) => ({
    headline: `Story number ${n}`,
    summary: `Summary of story ${n}.`,
    story: Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1} of story ${n}.`).join('\n\n'),
    localAngle: 'It happened in Limerick.',
    section: 'News',
    importance: 3,
    positivity: 3,
    originalTitle: `Original title ${n}`,
    originalSource: 'limerickpost',
    originalLink: `https://www.limerickpost.ie/story-${n}/`,
    publishedAt: hoursAgo(n),
    rewrittenAt: NOW,
    ...extra
});

/** Build a site from 13 recent stories plus the special cases, and return helpers to read it. */
function build(t) {
    quiet(t);
    freezeClock(t, NOW);
    const rewritten = {};
    for (let n = 1; n <= 13; n++) rewritten[`id-${n}`] = story(n);
    Object.assign(rewritten, {
        old: story(240, { headline: 'A story from ten days ago' }),
        skipped: { skipped: true, rewrittenAt: NOW },
        duplicate: { skipped: true, duplicateOf: 'id-1', rewrittenAt: NOW },
        // A full rewrite taken down by hand by setting skipped
        withdrawn: story(17, { headline: 'A withdrawn story', skipped: true }),
        sameHeadline: story(14, { headline: 'Story number 1', originalLink: 'https://www.limerickpost.ie/other/' }),
        hostile: story(15, {
            headline: '<script>alert(1)</script> & "quoted"',
            summary: '<img src=x onerror=alert(2)>',
            originalLink: 'javascript:alert(3)',
            imageUrl: 'data:image/png;base64,AAAA',
            section: 'not a section'
        }),
        brief: story(16, {
            headline: 'A short brief', brief: true, originalSource: 'limerickleader',
            originalLink: 'https://www.limerickleader.ie/brief-16', story: 'One short paragraph.',
            imageUrl: 'https://www.limerickleader.ie/photo.jpg', imageCredit: 'Limerick Leader'
        })
    });
    useStore({ rewritten });
    const site = tempDir('site');
    process.env.SITE_DIR = site;
    t.after(() => { delete process.env.SITE_DIR; });
    const builder = loadScript('build-site');
    builder.buildSite();

    const read = file => fs.readFileSync(path.join(site, file), 'utf8');
    const json = JSON.parse(read('data/articles.json'));
    const pageFor = id => read(`articles/${builder.slugFor(id)}.html`);
    return { site, read, json, pageFor, builder };
}

test('the build makes a page for every published story and none for skipped ones or repeated headlines', t => {
    const { site } = build(t);
    const pages = fs.readdirSync(path.join(site, 'articles'));
    assert.equal(pages.length, 16, '13 recent + old + hostile + brief');
    assert.ok(!pages.some(p => /skipped|duplicate|sameHeadline|withdrawn/.test(p)));
    assert.doesNotMatch(fs.readFileSync(path.join(site, 'sections/all.html'), 'utf8'), /A withdrawn story/);
    for (const file of ['index.html', '404.html', 'styles.css', 'sections/all.html', 'sections/news.html']) {
        assert.ok(fs.existsSync(path.join(site, file)), file);
    }
});

test('the front page has the last 7 days when there are at least 12 stories, and the archive has the rest', t => {
    const { json, read } = build(t);
    assert.equal(json.generatedAt, NOW);
    assert.equal(json.archiveCount, 16);
    assert.equal(json.count, 15);
    assert.ok(!json.articles.some(a => a.headline === 'A story from ten days ago'));
    assert.match(read('sections/all.html'), /A story from ten days ago/);
    assert.deepEqual(json.articles.slice(0, 3).map(a => a.headline), ['Story number 1', 'Story number 2', 'Story number 3']);
});

test('the front page is topped up to 12 stories in a quiet week', t => {
    quiet(t);
    freezeClock(t, NOW);
    const rewritten = {};
    for (let n = 1; n <= 14; n++) rewritten[`id-${n}`] = story(n * 24); // one a day for a fortnight
    useStore({ rewritten });
    process.env.SITE_DIR = tempDir('site');
    t.after(() => { delete process.env.SITE_DIR; });
    loadScript('build-site').buildSite();
    const json = JSON.parse(fs.readFileSync(path.join(process.env.SITE_DIR, 'data/articles.json'), 'utf8'));
    assert.equal(json.count, 12);
});

test('front page entries carry the list fields and at most six opening paragraphs', t => {
    const { json } = build(t);
    const first = json.articles[0];
    assert.equal(first.lead.length, 6);
    assert.equal(first.originalSource, 'Limerick Post');
    assert.equal(first.sourceHome, 'https://www.limerickpost.ie/');
    assert.equal(first.originalLink, 'https://www.limerickpost.ie/story-1/');
    assert.equal(first.story, undefined, 'the full story is not sent to the front page');
});

test('text from feeds and Gemini is escaped, and only http(s) links and images are used', t => {
    const { json, pageFor, read } = build(t);
    const page = pageFor('hostile');
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot;/);
    assert.doesNotMatch(page, /<script>alert|<img src=x|javascript:|data:image/);
    assert.match(page, /<span class="kicker">News<\/span>/, 'an unknown section falls back to keywords, then News');
    assert.doesNotMatch(read('sections/all.html'), /<script>alert|javascript:/);

    const entry = json.articles.find(a => a.headline.includes('alert(1)'));
    assert.equal(entry.originalLink, null);
    assert.equal(entry.imageUrl, undefined);
});

test('every story page credits the outlet and links to the original', t => {
    const { pageFor } = build(t);
    const page = pageFor('id-1');
    assert.match(page, /from original reporting by <strong>Limerick Post<\/strong>, &ldquo;Original title 1&rdquo;/);
    assert.match(page, /<a href="https:\/\/www\.limerickpost\.ie\/story-1\/"[^>]*>Read the original article/);
});

test('a brief says it was written from the headline and summary, and points to the full story', t => {
    const { pageFor } = build(t);
    const page = pageFor('brief');
    assert.match(page, /written by AI for The 061 from the headline and summary of <strong>Limerick Leader<\/strong>/);
    assert.match(page, /Read the full story at Limerick Leader/);
    assert.match(page, /<figcaption>Photo: Limerick Leader<\/figcaption>/, 'a credit that only repeats the outlet is not doubled');
});
