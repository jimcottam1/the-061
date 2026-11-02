const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { fixture, mockFetch, useStore, loadScript, freezeClock, quiet } = require('./helpers');

const NOW = '2026-11-02T12:00:00.000Z'; // a Monday; Irish time is GMT again
const OUT = process.env.EVENTS_PATH;
const UA = 'The061/1.0 (+https://jimcottam1.github.io/the-061/)';

const FOLK = /whats-on\/music\/winter-folk-night/;
const EXHIBITION = /whats-on\/art-exhibitions\/lakeside-pictures/;
const PAST = /whats-on\/community\/harvest-quiz-supper/;
// A page for the quiz, which is already over
const pastPage = fixture('event-page-folk.html').replace('2026-11-05T20:00:00+0000', '2026-10-20T19:00:00+0100').replace('2026-11-05T23:30:00+0000', '2026-10-20T22:00:00+0100');

const routes = (feed = fixture('feed-events.xml')) => [
    [/browse\/feed/, feed],
    [FOLK, fixture('event-page-folk.html')],
    [EXHIBITION, fixture('event-page-exhibition.html')],
    [PAST, pastPage]
];
const read = () => JSON.parse(fs.readFileSync(OUT, 'utf8'));

async function run(t, answers = routes(), { keep = false } = {}) {
    quiet(t);
    freezeClock(t, NOW);
    if (!keep) fs.rmSync(OUT, { force: true });
    useStore();
    const requests = mockFetch(answers);
    await loadScript('fetch-events').fetchEvents();
    return requests;
}

test('private, test and council items are dropped; the rest become facts about the event', async t => {
    await run(t);
    const out = read();
    assert.deepEqual(out.source, { name: 'Limerick.ie', url: 'https://www.limerick.ie/discover/whats-on' });
    assert.equal(out.updatedAt, NOW);
    assert.deepEqual(out.events.map(e => e.id), ['900006', '900005']);
    assert.deepEqual(out.events[1], {
        id: '900005',
        title: 'Winter Folk Night <Live>',
        url: 'https://www.limerick.ie/discover/whats-on/music/winter-folk-night',
        start: '2026-11-05T20:00:00.000Z',
        end: '2026-11-05T23:30:00.000Z',
        place: 'The Mill Room, Limerick City',
        price: '€15 Full / €10 Concession (per night)'
    });
    assert.deepEqual(out.events[0], {
        id: '900006',
        title: 'Lakeside Pictures: A Winter Exhibition',
        url: 'https://www.limerick.ie/discover/whats-on/art-exhibitions/lakeside-pictures',
        start: '2026-09-01T09:00:00.000Z',
        end: '2027-01-10T17:00:00.000Z',
        place: 'Castleconnell',
        price: 'Free',
        free: true
    });
});

test('"PRIVATE:" and "Test" titles are dropped even under the right address', async t => {
    const extra = ['PRIVATE: Hidden Event', 'Test', 'test'].map((title, i) => `<item><title>${title}</title><link>https://www.limerick.ie/discover/whats-on/music/hidden-${i}</link><guid isPermaLink="false">91000${i}</guid></item>`).join('');
    const requests = await run(t, [...routes(fixture('feed-events.xml').replace('</channel>', `${extra}</channel>`)), [/hidden-/, fixture('event-page-folk.html')]]);
    assert.ok(!requests.some(r => /hidden-/.test(r.url)));
    assert.deepEqual(read().events.map(e => e.id), ['900006', '900005']);
});

test('nothing from the council\'s descriptions or images is kept', async t => {
    await run(t);
    assert.doesNotMatch(fs.readFileSync(OUT, 'utf8'), /INVENTED-DESCRIPTION|invented\.png|description|image/i);
});

test('only the live event pages are fetched, politely, with an honest User-Agent', async t => {
    const requests = await run(t);
    assert.deepEqual(requests.map(r => r.url).filter(u => !/feed/.test(u)).length, 3, 'folk, exhibition and the past quiz');
    assert.ok(!requests.some(r => /council|private|\/test$/.test(r.url)));
    for (const r of requests) assert.equal(r.headers['User-Agent'], UA);
});

test('an event that has ended is left out, and not looked up again next run', async t => {
    await run(t);
    const out = read();
    assert.ok(!out.events.some(e => e.id === '900004'));
    assert.deepEqual(out.past, ['900004']);
    const again = await run(t, routes(), { keep: true });
    assert.ok(!again.some(r => PAST.test(r.url)), 'the finished quiz is not fetched again');
});

test('an event that ended earlier than the frozen clock is dropped, one still on is kept', async t => {
    // Folk night ends 23:30 on 5 Nov: kept at noon on the 5th, gone by the 6th
    await run(t);
    freezeClock(t, '2026-11-05T22:00:00.000Z');
    useStore();
    mockFetch(routes());
    await loadScript('fetch-events').fetchEvents();
    assert.ok(read().events.some(e => e.id === '900005'));
    freezeClock(t, '2026-11-06T00:30:00.000Z');
    useStore();
    mockFetch(routes());
    await loadScript('fetch-events').fetchEvents();
    assert.ok(!read().events.some(e => e.id === '900005'));
});

test('cached events are not fetched again; only new ones are', async t => {
    await run(t);
    const feed = fixture('feed-events.xml').replace('</channel>', `<item>
  <title>Brand New Event</title><link>https://www.limerick.ie/discover/whats-on/music/brand-new-event</link>
  <guid isPermaLink="false">900007</guid></item></channel>`);
    const requests = await run(t, [...routes(feed), [/brand-new-event/, fixture('event-page-exhibition.html')]], { keep: true });
    assert.deepEqual(requests.map(r => r.url).filter(u => !/feed/.test(u)), ['https://www.limerick.ie/discover/whats-on/music/brand-new-event']);
    assert.deepEqual(read().events.map(e => e.id).sort(), ['900005', '900006', '900007']);
});

test('an event that has left the feed leaves the file', async t => {
    await run(t);
    await run(t, routes(fixture('feed-events.xml').replace(/<item>\s*<title>Lakeside[\s\S]*?<\/item>/, '')), { keep: true });
    assert.deepEqual(read().events.map(e => e.id), ['900005']);
});

test('at most 40 new pages are fetched in one run', async t => {
    const items = Array.from({ length: 45 }, (_, i) => `<item><title>Event ${i}</title><link>https://www.limerick.ie/discover/whats-on/music/event-${i}</link><guid isPermaLink="false">8${i}</guid></item>`).join('');
    const feed = `<rss version="2.0"><channel>${items}</channel></rss>`;
    const requests = await run(t, [[/browse\/feed/, feed], [/event-\d+/, fixture('event-page-exhibition.html')]]);
    assert.equal(requests.length, 41, 'the feed and 40 pages');
    assert.equal(read().events.length, 40);
});

test('a page that fails or has no dates is skipped, not cached', async t => {
    await run(t, [...routes().slice(0, 1), [FOLK, { status: 500 }], [EXHIBITION, '<html><body>no json-ld</body></html>'], [PAST, pastPage]]);
    assert.deepEqual(read().events, []);
});

test('a feed that is not an events feed throws and leaves the last file alone', async t => {
    await run(t);
    const before = fs.readFileSync(OUT, 'utf8');
    await assert.rejects(run(t, [[/browse\/feed/, '<html><body>maintenance</body></html>']], { keep: true }));
    await assert.rejects(run(t, [[/browse\/feed/, '<rss version="2.0"><channel></channel></rss>']], { keep: true }), /no items/);
    await assert.rejects(run(t, [[/browse\/feed/, { status: 503 }]], { keep: true }), /HTTP 503/);
    assert.equal(fs.readFileSync(OUT, 'utf8'), before);
});
