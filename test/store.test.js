const test = require('node:test');
const assert = require('node:assert/strict');
const { useStore, loadScript, freezeClock } = require('./helpers');
const { mergeStores } = require('../scripts/merge-store');

const NOW = '2026-11-01T12:00:00.000Z';
const daysAgo = (days, hours = 0) => new Date(Date.parse(NOW) - (days * 24 + hours) * 3600000).toISOString();

test('the store drops articles scraped, and rewrites made, over 30 days ago', t => {
    freezeClock(t, NOW);
    const file = useStore({
        articles: {
            fresh: { id: 'fresh', title: 'Fresh', scrapedAt: daysAgo(29, 23), pubDate: daysAgo(29, 23) },
            stale: { id: 'stale', title: 'Stale', scrapedAt: daysAgo(30, 1), pubDate: daysAgo(30, 1) }
        },
        rewritten: {
            fresh: { headline: 'Fresh', rewrittenAt: daysAgo(29, 23) },
            stale: { headline: 'Stale', rewrittenAt: daysAgo(30, 1) }
        }
    });
    const store = loadScript('lib/store');
    assert.deepEqual(store.getRecentArticles().map(a => a.id), ['fresh']);
    assert.equal(store.getRewritten('stale'), null);

    store.save();
    const saved = file.read();
    assert.deepEqual(Object.keys(saved.articles), ['fresh']);
    assert.deepEqual(Object.keys(saved.rewritten), ['fresh']);
});

test('expiry goes by when an article was scraped, not when it was published', t => {
    freezeClock(t, NOW);
    useStore({ articles: { a: { id: 'a', scrapedAt: daysAgo(2), pubDate: daysAgo(45) } } });
    assert.ok(loadScript('lib/store').hasArticle('a'));
});

test('recent articles and rewrites are listed newest published first', t => {
    freezeClock(t, NOW);
    useStore({
        articles: {
            old: { id: 'old', scrapedAt: daysAgo(1), pubDate: daysAgo(3) },
            new: { id: 'new', scrapedAt: daysAgo(1), pubDate: daysAgo(0, 2) },
            undated: { id: 'undated', scrapedAt: daysAgo(0, 1), pubDate: 'not a date' }
        },
        rewritten: {
            old: { publishedAt: daysAgo(3), rewrittenAt: daysAgo(1) },
            new: { publishedAt: daysAgo(0, 2), rewrittenAt: daysAgo(1) }
        }
    });
    const store = loadScript('lib/store');
    assert.deepEqual(store.getRecentArticles().map(a => a.id), ['undated', 'new', 'old']);
    assert.deepEqual(store.listRewritten().map(([id]) => id), ['new', 'old']);
});

// ---- merge-store: master moved on while a run was going ----

const base = {
    meta: { lastScrape: 'run-1' },
    articles: { a: { title: 'A' }, b: { title: 'B' }, gone: { title: 'Gone' } },
    rewritten: { a: { headline: 'A1' }, b: { headline: 'B1' } }
};

test('merge keeps what this run added or changed, and what master changed that this run left alone', () => {
    const ours = {
        meta: { lastScrape: 'run-2' },
        articles: { a: { title: 'A' }, b: { title: 'B' }, gone: { title: 'Gone' }, c: { title: 'C (new this run)' } },
        rewritten: { a: { headline: 'A2 (rewritten this run)' }, b: { headline: 'B1' }, c: { headline: 'C1' } }
    };
    const theirs = {
        meta: { lastScrape: 'run-1' },
        articles: { ...base.articles, d: { title: 'D (hand-added on master)' } },
        rewritten: { a: { headline: 'A1' }, b: { headline: 'B fixed by hand on master' } }
    };
    const merged = mergeStores(base, ours, theirs);
    assert.equal(merged.meta.lastScrape, 'run-2');
    assert.deepEqual(Object.keys(merged.articles).sort(), ['a', 'b', 'c', 'd', 'gone']);
    assert.equal(merged.rewritten.a.headline, 'A2 (rewritten this run)');
    assert.equal(merged.rewritten.b.headline, 'B fixed by hand on master');
    assert.equal(merged.rewritten.c.headline, 'C1');
});

test('rewrites cleared on master stay cleared, apart from ones this run made', () => {
    const ours = { ...base, rewritten: { ...base.rewritten, c: { headline: 'C1' } } };
    const theirs = { ...base, rewritten: {} };
    const merged = mergeStores(base, ours, theirs);
    assert.deepEqual(merged.rewritten, { c: { headline: 'C1' } });
});

test('merge keeps articles this run pruned removed, unless master changed them meanwhile', () => {
    const ours = { ...base, articles: { a: { title: 'A' }, b: { title: 'B' } } };
    assert.ok(!('gone' in mergeStores(base, ours, base).articles));

    const theirs = { ...base, articles: { ...base.articles, gone: { title: 'Gone, edited on master' } } };
    assert.equal(mergeStores(base, ours, theirs).articles.gone.title, 'Gone, edited on master');
});

test('merge with no base store (the first run) keeps everything from both', () => {
    const merged = mergeStores({}, { articles: { a: { title: 'A' } } }, { articles: { b: { title: 'B' } } });
    assert.deepEqual(Object.keys(merged.articles).sort(), ['a', 'b']);
});
