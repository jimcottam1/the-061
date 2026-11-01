const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockFetch, mockGemini, useStore, loadScript, freezeClock, quiet } = require('./helpers');

const NOW = '2026-11-01T12:00:00.000Z';

const article = (id, host, title, hoursAgo, extra = {}) => ({
    id, title, link: `https://${host}/${id}/`, source: host.split('.')[1],
    description: `${title}: the feed's one-line summary of the story.`,
    pubDate: new Date(Date.parse(NOW) - hoursAgo * 3600000).toISOString(),
    scrapedAt: NOW,
    ...extra
});

const REWRITE = {
    headline: 'Councillors seek night and weekend animal welfare cover',
    summary: 'Councillors want an animal welfare officer on call out of hours.',
    story: 'First paragraph.\n\nSecond paragraph.',
    localAngle: 'Stray horses on Limerick roads.',
    section: 'arts and culture',
    importance: '4',
    positivity: 9
};

/** Gemini stand-in: the Limerick check by title, then the rewrite (wrapped in a code fence, as Gemini often does). */
function gemini({ limerick = () => 'YES', rewrite = () => '```json\n' + JSON.stringify(REWRITE) + '\n```' } = {}) {
    return mockGemini(prompt => {
        if (prompt.startsWith('Does this article have ANY connection to Limerick')) {
            return limerick(prompt.match(/\nArticle: (.*)/)[1]);
        }
        return rewrite(prompt);
    });
}

function run(t, articles) {
    quiet(t);
    t.mock.method(console, 'error', () => {});
    freezeClock(t, NOW);
    const store = useStore({ articles: Object.fromEntries(articles.map(a => [a.id, a])) });
    return { store, rewrite: max => loadScript('rewrite-articles').rewriteArticles(max) };
}

test('a story whose page can be read is rewritten from its full text, with its credit and link kept', async t => {
    const post = article('p1', 'www.limerickpost.ie', 'Calls for out-of-hours animal welfare officer', 2,
        { imageUrl: 'https://www.limerickpost.ie/photo.jpg', imageCredit: 'A Photographer' });
    const { store, rewrite } = run(t, [post]);
    mockFetch([[/limerickpost\.ie\/p1\//, fixture('article-page.html')]]);
    const prompts = gemini();
    await rewrite(10);

    const saved = store.read().rewritten.p1;
    assert.equal(saved.headline, REWRITE.headline);
    assert.equal(saved.brief, undefined);
    assert.equal(saved.section, 'Arts & Culture', 'section names are normalised');
    assert.equal(saved.importance, 4);
    assert.equal(saved.positivity, undefined, 'an out-of-range rating is dropped');
    assert.equal(saved.originalTitle, post.title);
    assert.equal(saved.originalSource, 'limerickpost');
    assert.equal(saved.originalLink, post.link);
    assert.equal(saved.publishedAt, post.pubDate);
    assert.equal(saved.rewrittenAt, NOW);

    const rewritePrompt = prompts[1];
    assert.match(rewritePrompt, /FULL CONTENT:\n.*People are ringing and nobody answers/);
    assert.doesNotMatch(rewritePrompt, /not article text|Most read|Share on Facebook/, 'scripts, asides and share buttons are stripped');
});

test('a story whose page is blocked gets a short brief from its title and summary', async t => {
    const leader = article('l1', 'www.limerickleader.ie', 'Night-time roadworks on the Ennis Road', 1);
    const { store, rewrite } = run(t, [leader]);
    mockFetch([[/limerickleader/, { status: 403, statusText: 'Forbidden' }]]);
    const prompts = gemini();
    await rewrite(10);

    assert.equal(store.read().rewritten.l1.brief, true);
    assert.match(prompts[1], /only the title and summary are available/);
    assert.match(prompts[1], /Summary: Night-time roadworks on the Ennis Road: the feed's one-line summary/);
    assert.doesNotMatch(prompts[1], /FULL CONTENT/);
});

test('a story with no Limerick connection is remembered as skipped, without a rewrite', async t => {
    const story = article('x1', 'www.limerickpost.ie', 'Dublin bus fares rise', 1);
    const { store, rewrite } = run(t, [story]);
    mockFetch([[/./, { status: 404 }]]);
    const prompts = gemini({ limerick: () => 'NO' });
    await rewrite(10);
    assert.deepEqual(store.read().rewritten.x1, { skipped: true, rewrittenAt: NOW });
    assert.equal(prompts.length, 1);
});

test('when Gemini fails or answers badly, nothing is saved so the next run tries again', async t => {
    const checkFails = article('e1', 'www.limerickpost.ie', 'Check fails', 3);
    const noStory = article('e2', 'www.limerickpost.ie', 'Rewrite has no story', 2);
    const notJson = article('e3', 'www.limerickpost.ie', 'Rewrite is not JSON', 1);
    const { store, rewrite } = run(t, [checkFails, noStory, notJson]);
    mockFetch([[/./, { status: 404 }]]);
    gemini({
        limerick: title => { if (title === 'Check fails') throw new Error('503 Service Unavailable'); return 'YES'; },
        rewrite: prompt => /Rewrite has no story/.test(prompt)
            ? JSON.stringify({ ...REWRITE, story: ' ' })
            : 'Sorry, I cannot help with that.'
    });
    await rewrite(10);
    assert.deepEqual(store.read().rewritten, {});
});

test('rewriting stops after the number of stories it was given, newest first, skipping ones already done', async t => {
    const stories = [1, 2, 3, 4].map(n => article(`s${n}`, 'www.limerickpost.ie', `Story ${n}`, n));
    const { store, rewrite } = run(t, stories);
    // s1 (the newest) was done on an earlier run
    const file = store.read();
    file.rewritten.s1 = { headline: 'Done already', rewrittenAt: NOW };
    require('fs').writeFileSync(store.path, JSON.stringify(file));
    mockFetch([[/./, { status: 404 }]]);
    gemini();
    await rewrite(2);
    assert.deepEqual(Object.keys(store.read().rewritten).sort(), ['s1', 's2', 's3']);
    assert.equal(store.read().rewritten.s1.headline, 'Done already');
});
