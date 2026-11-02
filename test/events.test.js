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

async function run(t, answers = routes(), { keep = false, at = NOW } = {}) {
    quiet(t);
    freezeClock(t, at);
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
        price: '€15 Full / €10 Concession (per night)',
        checkedAt: NOW
    });
    assert.deepEqual(out.events[0], {
        id: '900006',
        title: 'Lakeside Pictures: A Winter Exhibition',
        url: 'https://www.limerick.ie/discover/whats-on/art-exhibitions/lakeside-pictures',
        start: '2026-09-01T09:00:00.000Z',
        end: '2027-01-10T17:00:00.000Z',
        place: 'Castleconnell',
        price: 'Free',
        checkedAt: NOW,
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
    assert.deepEqual(out.past, [{ id: '900004', title: 'Harvest Quiz & Supper', checkedAt: NOW }]);
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

const pageUrls = requests => requests.map(r => r.url).filter(u => !/feed/.test(u));
const hours = h => new Date(Date.parse(NOW) + h * 3600000).toISOString();
const days = d => hours(d * 24);
/** The folk night's page with other dates. */
const folkOn = (start, end) => fixture('event-page-folk.html').replace('2026-11-05T20:00:00+0000', start).replace('2026-11-05T23:30:00+0000', end);

test('the feed\'s title is used on every run, and a changed title makes the page be read again', async t => {
    await run(t);
    const renamed = fixture('feed-events.xml').replace('Winter Folk Night &lt;Live&gt;', 'Winter Folk Night (Sold Out)');
    const requests = await run(t, routes(renamed), { keep: true, at: hours(1) });
    assert.deepEqual(pageUrls(requests), ['https://www.limerick.ie/discover/whats-on/music/winter-folk-night']);
    assert.equal(read().events.find(e => e.id === '900005').title, 'Winter Folk Night (Sold Out)');
});

test('pages are read again when more than 3 days old, and not before', async t => {
    await run(t);
    assert.deepEqual(pageUrls(await run(t, routes(), { keep: true, at: days(2.9) })).filter(u => EXHIBITION.test(u)), [], 'still fresh at 2.9 days');
    const requests = await run(t, routes(), { keep: true, at: days(3.1) });
    assert.ok(pageUrls(requests).some(u => EXHIBITION.test(u)), 'stale after 3 days');
});

test('an event is checked again on every run once it is within 2 days of its start', async t => {
    await run(t);
    const requests = await run(t, routes(), { keep: true, at: '2026-11-03T21:00:00.000Z' }); // 23 hours to go
    assert.deepEqual(pageUrls(requests).filter(u => FOLK.test(u)).length, 1);
});

test('a postponed event moves to its new date, even if its old date had passed', async t => {
    await run(t);
    // A week on: the cached 5 November date has passed, but it was last checked 6 days ago, so it is not written off
    const moved = routes();
    moved[1] = [FOLK, folkOn('2026-11-20T20:00:00+0000', '2026-11-20T23:30:00+0000')];
    await run(t, moved, { keep: true, at: days(6) });
    const out = read();
    assert.equal(out.events.find(e => e.id === '900005').start, '2026-11-20T20:00:00.000Z');
    assert.ok(!out.past.some(p => p.id === '900005'));
});

test('a stale cached date that has passed is not remembered as finished when there is no chance to check it', async t => {
    await run(t);
    const many = Array.from({ length: 45 }, (_, i) => `<item><title>Filler ${i}</title><link>https://www.limerick.ie/discover/whats-on/music/filler-${i}</link><guid isPermaLink="false">7${i}</guid></item>`).join('');
    const feed = fixture('feed-events.xml').replace('<item>', `${many}<item>`);
    await run(t, [...routes(feed), [/filler-/, { status: 500 }]], { keep: true, at: days(6) });
    assert.ok(!read().past.some(p => p.id === '900005'), 'not written off');
});

test('with no page fetches left, a cached event still gets the feed\'s new title', async t => {
    await run(t);
    const many = Array.from({ length: 45 }, (_, i) => `<item><title>Filler ${i}</title><link>https://www.limerick.ie/discover/whats-on/music/filler-${i}</link><guid isPermaLink="false">7${i}</guid></item>`).join('');
    const feed = fixture('feed-events.xml').replace('<item>', `${many}<item>`).replace('Winter Folk Night &lt;Live&gt;', 'Winter Folk Night (Moved)');
    await run(t, [...routes(feed), [/filler-/, { status: 500 }]], { keep: true });
    assert.equal(read().events.find(e => e.id === '900005').title, 'Winter Folk Night (Moved)');
});

test('items titled CANCELLED are dropped, however they are capitalised', async t => {
    const extra = ['CANCELLED: Winter Fair', 'Cancelled - Spring Fair'].map((title, i) => `<item><title>${title}</title><link>https://www.limerick.ie/discover/whats-on/music/off-${i}</link><guid isPermaLink="false">92000${i}</guid></item>`).join('');
    const requests = await run(t, [...routes(fixture('feed-events.xml').replace('</channel>', `${extra}</channel>`)), [/off-/, fixture('event-page-folk.html')]]);
    assert.ok(!pageUrls(requests).some(u => /off-/.test(u)));
    assert.deepEqual(read().events.map(e => e.id), ['900006', '900005']);
});

test('a page that failed is not tried again for 24 hours', async t => {
    const failing = [...routes().slice(0, 1), [FOLK, { status: 500 }], [EXHIBITION, fixture('event-page-exhibition.html')], [PAST, pastPage]];
    await run(t, failing);
    assert.deepEqual(read().failed.map(f => f.id), ['900005']);
    assert.ok(!read().events.some(e => e.id === '900005'));
    assert.deepEqual(pageUrls(await run(t, failing, { keep: true, at: hours(23) })).filter(u => FOLK.test(u)), [], 'too soon');
    assert.equal(pageUrls(await run(t, routes(), { keep: true, at: hours(25) })).filter(u => FOLK.test(u)).length, 1, 'after a day');
    assert.ok(read().events.some(e => e.id === '900005'));
    assert.deepEqual(read().failed, []);
});

test('a page with no dates is also remembered as failed', async t => {
    await run(t, [...routes().slice(0, 1), [FOLK, '<html><body>nothing</body></html>'], [EXHIBITION, fixture('event-page-exhibition.html')], [PAST, pastPage]]);
    assert.deepEqual(read().failed.map(f => f.id), ['900005']);
});

test('an all-day event (a date with no time) is over only when its Irish day ends, not at UTC midnight', async t => {
    const allDay = [...routes().slice(0, 1), [FOLK, folkOn('2026-07-11', '2026-07-11')], [EXHIBITION, '<html></html>'], [PAST, '<html></html>']];
    await run(t, allDay, { at: '2026-07-11T15:00:00.000Z' });
    assert.deepEqual(read().events.map(e => [e.id, e.allDay]), [['900005', true]], 'still on during the afternoon');
    await run(t, allDay, { keep: true, at: '2026-07-11T22:30:00.000Z' }); // 23:30 in Ireland
    assert.equal(read().events.length, 1, 'still on at 23:30 Irish time');
    await run(t, allDay, { keep: true, at: '2026-07-11T23:30:00.000Z' }); // 00:30 the next day
    assert.equal(read().events.length, 0, 'over once the day has ended');
});
