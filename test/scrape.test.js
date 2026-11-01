const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockFetch, useStore, loadScript, freezeClock, quiet } = require('./helpers');

const NOW = '2026-11-01T12:00:00.000Z';
const FEEDS = 'https://www.limerickpost.ie/feed/,https://www.limerickleader.ie/rss/,https://www.example-broken.ie/feed/';

/** Scrape the two saved feeds (plus one that fails) into `data`, and return the saved store. */
async function scrape(t, data = {}) {
    quiet(t);
    t.mock.method(console, 'error', () => {});
    freezeClock(t, NOW);
    process.env.RSS_FEEDS = FEEDS;
    t.after(() => { process.env.RSS_FEEDS = ''; });
    const store = useStore(data);
    const requests = mockFetch([
        [/limerickpost\.ie\/feed/, fixture('feed-wordpress.xml')],
        [/limerickleader\.ie\/rss/, fixture('feed-leader.xml')],
        [/example-broken/, { status: 500, statusText: 'Server Error' }]
    ]);
    await loadScript('scrape-news').scrapeNews();
    return { saved: store.read(), requests };
}

const titles = saved => Object.values(saved.articles).map(a => a.title).sort();

test('scrape keeps news and drops club notes, results lists, competitions, lotto and short items', async t => {
    const { saved } = await scrape(t);
    assert.deepEqual(titles(saved), [
        'Calls for out-of-hours animal welfare officer',
        'Library opens new reading room',
        'Night-time roadworks on the Ennis Road next week',
        'Treaty United sign new striker ahead of new season'
    ]);
});

test('scrape drops posts over 14 days old, keeping one just inside the limit', async t => {
    const { saved } = await scrape(t);
    const list = titles(saved);
    assert.ok(list.includes('Library opens new reading room'), '13 days 23 hours old: kept');
    assert.ok(!list.includes('Council report from last month'), '14 days 1 hour old: dropped');
});

test('scrape keeps only the first of two stories with the same headline', async t => {
    const { saved } = await scrape(t);
    const welfare = Object.values(saved.articles).filter(a => /animal welfare/.test(a.title));
    assert.equal(welfare.length, 1);
    assert.equal(welfare[0].source, 'limerickpost');
});

test('scrape reads ids, links, plain-text descriptions, sources and feed photos with credits', async t => {
    const { saved } = await scrape(t);
    const post = saved.articles['https://www.limerickpost.ie/?p=1001'];
    assert.equal(post.link, 'https://www.limerickpost.ie/2026/10/31/calls-for-out-of-hours-animal-welfare-officer/');
    assert.equal(post.source, 'limerickpost');
    assert.match(post.description, /^Councillors have asked/);
    assert.doesNotMatch(post.description, /<p>/);

    const leader = saved.articles['9300002'];
    assert.equal(leader.source, 'limerickleader');
    assert.equal(leader.imageUrl, 'https://www.limerickleader.ie/jpim-static/image/2026/11/01/striker.jpeg?width=1200&auto=webp');
    assert.equal(leader.imageCredit, "Sean O'Doherty");
    assert.equal(saved.articles['9300003'].imageUrl, undefined);
    assert.equal(saved.meta.lastScrape, new Date(NOW).toISOString());
});

test('scrape adds a feed photo to a stored article that had none, and keeps its rewrite', async t => {
    const stored = {
        id: '9300002', title: 'Treaty United sign new striker ahead of new season', link: 'https://www.limerickleader.ie/x',
        description: 'Stored before photos were collected.', pubDate: '2026-11-01T09:30:00Z', source: 'limerickleader',
        scrapedAt: '2026-11-01T10:00:00Z'
    };
    const rewrite = { headline: 'Striker joins Treaty', rewrittenAt: '2026-11-01T10:05:00Z' };
    const { saved } = await scrape(t, { articles: { 9300002: stored }, rewritten: { 9300002: rewrite } });
    assert.equal(saved.articles['9300002'].description, 'Stored before photos were collected.');
    assert.match(saved.articles['9300002'].imageUrl, /striker\.jpeg/);
    assert.deepEqual(saved.rewritten['9300002'], rewrite);
});

test('a feed that fails is skipped and the others are still saved', async t => {
    const { saved, requests } = await scrape(t);
    assert.ok(requests.some(r => /example-broken/.test(r.url)));
    assert.equal(Object.keys(saved.articles).length, 4);
});
