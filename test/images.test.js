const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockFetch, useStore, loadScript, freezeClock, quiet } = require('./helpers');

const NOW = '2026-11-01T12:00:00.000Z';
const PAGE = 'https://www.limerickpost.ie/2026/10/31/welfare/';

test('the lead photo skips share cards and is made absolute', async () => {
    useStore();
    mockFetch([[/./, fixture('article-page.html')]]);
    const url = await loadScript('fetch-images').findImage(PAGE);
    assert.equal(url, 'https://www.limerickpost.ie/site/wp-content/uploads/2026/10/horses.jpg?w=800&h=600');
});

test('the JSON-LD thumbnail is used when the page has no other photo', async () => {
    useStore();
    const page = fixture('article-page.html').replace(/<meta name="twitter:image"[^>]*>/, '');
    mockFetch([[/./, page]]);
    const url = await loadScript('fetch-images').findImage(PAGE);
    assert.equal(url, 'https://www.limerickpost.ie/site/wp-content/uploads/2026/10/horses-thumb.jpg');
});

test('images: feed photos come first, blocked pages are not tried again, and passing failures are', async t => {
    quiet(t);
    t.mock.method(console, 'error', () => {});
    freezeClock(t, NOW);
    const rewritten = (id, link) => ({ headline: `Story ${id}`, originalLink: link, publishedAt: NOW, rewrittenAt: NOW });
    const store = useStore({
        articles: { feed: { id: 'feed', imageUrl: 'https://www.limerickleader.ie/feed.jpg', imageCredit: 'A Photographer', scrapedAt: NOW } },
        rewritten: {
            feed: rewritten('feed', 'https://www.limerickleader.ie/feed'),
            page: rewritten('page', PAGE),
            blocked: rewritten('blocked', 'https://www.limerickleader.ie/blocked'),
            down: rewritten('down', 'https://www.limerickvoice.com/down'),
            done: { ...rewritten('done', 'https://x.ie/done'), imageCheckedAt: NOW },
            skipped: { skipped: true, rewrittenAt: NOW }
        }
    });
    const requests = mockFetch([
        [/welfare/, fixture('article-page.html')],
        [/blocked/, { status: 403 }],
        [/down/, { status: 503 }]
    ]);
    await loadScript('fetch-images').fetchImages();

    const saved = store.read().rewritten;
    assert.equal(saved.feed.imageUrl, 'https://www.limerickleader.ie/feed.jpg');
    assert.equal(saved.feed.imageCredit, 'A Photographer');
    assert.match(saved.page.imageUrl, /horses\.jpg/);
    assert.equal(saved.blocked.imageCheckedAt, NOW);
    assert.equal(saved.down.imageCheckedAt, undefined, 'a 503 is tried again next run');
    assert.deepEqual(requests.map(r => r.url).sort(), [PAGE, 'https://www.limerickleader.ie/blocked', 'https://www.limerickvoice.com/down'].sort());
});
