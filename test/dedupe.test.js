const test = require('node:test');
const assert = require('node:assert/strict');
const { mockGemini, useStore, loadScript, freezeClock, quiet } = require('./helpers');

const NOW = '2026-11-01T12:00:00.000Z';

const article = (id, title, hoursAgo) => ({
    id, title, link: `https://www.limerickpost.ie/${id}/`, source: 'limerickpost',
    description: `${title}. A description long enough to send to Gemini.`,
    pubDate: new Date(Date.parse(NOW) - hoursAgo * 3600000).toISOString(),
    scrapedAt: new Date(Date.parse(NOW) - hoursAgo * 3600000).toISOString()
});

// One story already published, one judged to have no Limerick link, and three new ones:
// a repeat of the published story, a repeat of another new one, and something different.
function seed() {
    return useStore({
        articles: {
            kept: article('kept', 'Horse welfare officer sought by council', 30),
            offtopic: article('offtopic', 'Dublin bus fares rise', 29),
            repeat: article('repeat', 'Councillors want night-time animal warden', 3),
            match: article('match', 'Treaty United beat Cork', 2),
            match2: article('match2', 'Win for Treaty United against Cork City', 1)
        },
        rewritten: {
            kept: { headline: 'Council asked for night animal welfare cover', rewrittenAt: NOW },
            offtopic: { skipped: true, rewrittenAt: NOW }
        }
    });
}

/** Gemini stand-in: answers by which story the NEW ARTICLE is, using the numbered LIST it was sent. */
function geminiSaysDuplicates(pairs) {
    return prompt => {
        const title = prompt.match(/NEW ARTICLE:\nTitle: (.*)/)[1];
        const of = pairs[title];
        if (!of) return 'NONE';
        const line = prompt.split('\n').find(l => new RegExp(`^\\d+\\. ${of}`).test(l));
        return line.match(/^\d+/)[0];
    };
}

test('dedupe marks a new story that repeats a published one, or an earlier new one, as a skipped duplicate', async t => {
    quiet(t);
    freezeClock(t, NOW);
    const store = seed();
    const prompts = mockGemini(geminiSaysDuplicates({
        'Councillors want night-time animal warden': 'Horse welfare officer sought by council',
        // New stories are checked newest first, so of two new repeats the older one is marked
        'Treaty United beat Cork': 'Win for Treaty United against Cork City'
    }));
    await loadScript('ai-deduplicate').aiDeduplicate();

    const saved = store.read();
    assert.deepEqual(saved.rewritten.repeat, { skipped: true, duplicateOf: 'kept', rewrittenAt: NOW });
    assert.equal(saved.rewritten.match.duplicateOf, 'match2');
    assert.equal(saved.rewritten.match2, undefined, 'the newer repeat is left for the rewrite step');
    assert.ok(!('offtopic' in saved.rewritten) || saved.rewritten.offtopic.skipped);
    assert.equal(prompts.length, 3, 'one call per new story');
    assert.ok(prompts.every(p => !p.includes('Dublin bus fares')), 'stories with no Limerick link are not compared');
});

test('dedupe keeps a story when Gemini fails, so nothing is lost', async t => {
    quiet(t);
    t.mock.method(console, 'error', () => {});
    freezeClock(t, NOW);
    const store = seed();
    mockGemini(() => { throw new Error('429 Too Many Requests'); });
    await loadScript('ai-deduplicate').aiDeduplicate();
    const saved = store.read();
    for (const id of ['repeat', 'match', 'match2']) assert.equal(saved.rewritten[id], undefined);
});

test('dedupe ignores an answer that points outside the list', async t => {
    quiet(t);
    freezeClock(t, NOW);
    const store = seed();
    mockGemini(() => '7');
    await loadScript('ai-deduplicate').aiDeduplicate();
    assert.equal(store.read().rewritten.repeat, undefined);
});
