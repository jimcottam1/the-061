const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { useStore, loadScript, freezeClock, tempDir, quiet } = require('./helpers');

const NOW = '2026-11-02T12:00:00.000Z'; // Monday; Irish time is GMT again
const SUMMER_NIGHT = '2026-07-10T23:30:00.000Z'; // 00:30 on Saturday 11 July in Ireland

const ev = (id, title, start, extra = {}) => ({ id, title, url: `https://www.limerick.ie/discover/whats-on/x/${id}`, start, ...extra });

const EVENTS = [
    ev('past', 'Finished Event', '2026-10-30T19:00:00.000Z', { end: '2026-10-30T21:00:00.000Z' }),
    ev('today', 'Today Quiz', '2026-11-02T19:00:00.000Z', { end: '2026-11-02T21:30:00.000Z', place: 'The Mill Room, Limerick City', price: '€5' }),
    ev('exhibition', 'Lakeside Pictures', '2026-09-01T09:00:00.000Z', { end: '2027-01-10T17:00:00.000Z', place: 'Castleconnell', price: 'Free', free: true }),
    ev('wed', 'Wednesday Talk', '2026-11-04T10:30:00.000Z'),
    ev('fri', 'Friday Gig', '2026-11-06T18:00:00.000Z'),
    ev('sat', 'Saturday Market', '2026-11-07T10:00:00.000Z', { end: '2026-11-07T15:00:00.000Z' }),
    ev('nextmon', 'Next Monday Class', '2026-11-09T09:00:00.000Z'),
    ev('december', 'December Carols', '2026-12-20T19:30:00.000Z'),
    ev('edge', 'Sixty Days Out', '2027-01-01T19:00:00.000Z'),
    ev('far', 'Too Far Away', '2027-01-05T19:00:00.000Z')
];

/** Build the site with the given events (or no events file) and return the What's On page. */
function build(t, events, now = NOW) {
    quiet(t);
    freezeClock(t, now);
    useStore();
    const file = path.join(tempDir('events'), 'events.json');
    if (events) fs.writeFileSync(file, JSON.stringify({ updatedAt: now, source: { name: 'Limerick.ie', url: 'https://www.limerick.ie/discover/whats-on' }, events, past: ['old-id'] }));
    process.env.EVENTS_PATH = file;
    const site = tempDir('site');
    process.env.SITE_DIR = site;
    t.after(() => { delete process.env.SITE_DIR; });
    loadScript('build-site').buildSite();
    const read = f => fs.readFileSync(path.join(site, f), 'utf8');
    return { read, site, page: read('whats-on.html') };
}

const text = html => html.replace(/<\/?a[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ');
/** Titles under one heading, in order. */
const under = (page, heading) => {
    const block = page.split('<section class="archive-day">').find(s => s.includes(`>${heading}</h2>`)) || '';
    return [...block.matchAll(/<h3 class="headline">.*?>([^<]+)<\/(?:a|h3)>/g)].map(m => m[1]);
};

test('events are grouped Today, This weekend, Next 7 days and Later; finished and far-off ones are left out', t => {
    const { page } = build(t, EVENTS);
    assert.deepEqual(under(page, 'Today'), ['Today Quiz', 'Lakeside Pictures']);
    assert.deepEqual(under(page, 'This weekend'), ['Friday Gig', 'Saturday Market']);
    assert.deepEqual(under(page, 'Next 7 days'), ['Wednesday Talk', 'Next Monday Class']);
    assert.deepEqual(under(page, 'Later'), ['December Carols', 'Sixty Days Out']);
    assert.doesNotMatch(page, /Finished Event|Too Far Away/);
    const order = ['>Today<', '>This weekend<', '>Next 7 days<', '>Later<'].map(h => page.indexOf(h));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('a long-running event already under way shows under Today as "Until <date>"', t => {
    const { page } = build(t, EVENTS);
    assert.match(text(page), /Until Sunday, 10 January/);
    assert.doesNotMatch(text(page), /Tuesday, 1 September/);
});

test('dates and times are shown in Irish time, with place and price', t => {
    const { page } = build(t, EVENTS);
    assert.match(text(page), /Monday, 2 November, 7pm to 9\.30pm/);
    assert.match(text(page), /Saturday, 7 November, 10am to 3pm/);
    assert.match(text(page), /The Mill Room, Limerick City · €5/);
    assert.match(text(page), /Castleconnell · Free/);
});

test('summer time: 23:30 UTC is already the next Irish day, so grouping follows Irish time', t => {
    const { page } = build(t, [
        ev('fri-night', 'Friday Night Gig', '2026-07-10T20:00:00.000Z'), // 21:00 Friday in Ireland: over
        ev('after-midnight', 'After Midnight', '2026-07-10T23:45:00.000Z'), // 00:45 Saturday: today
        ev('sat-eve', 'Saturday Evening', '2026-07-11T18:00:00.000Z'), // today
        ev('sun', 'Sunday Fair', '2026-07-12T10:00:00.000Z'), // the rest of this weekend
        ev('mon', 'Monday Class', '2026-07-13T10:00:00.000Z')
    ], SUMMER_NIGHT);
    assert.deepEqual(under(page, 'Today'), ['After Midnight', 'Saturday Evening']);
    assert.deepEqual(under(page, 'This weekend'), ['Sunday Fair']);
    assert.deepEqual(under(page, 'Next 7 days'), ['Monday Class']);
    assert.doesNotMatch(page, /Friday Night Gig/);
    assert.match(text(page), /Saturday, 11 July, 12\.45am/);
});

test('titles, places and prices are escaped, and only http(s) links are used', t => {
    const { page } = build(t, [
        ev('bad', '<script>alert(1)</script> & "Friends"', '2026-11-03T10:00:00.000Z', { place: '<img src=x onerror=alert(2)>', price: '"><b>€5</b>', url: 'javascript:alert(3)' }),
        ev('ok', 'Safe Event', '2026-11-03T11:00:00.000Z')
    ]);
    assert.doesNotMatch(page, /<script>alert|<img src=x|<b>€5/);
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Friends&quot;/);
    assert.doesNotMatch(page, /javascript:/);
    assert.match(page, /<a href="https:\/\/www\.limerick\.ie\/discover\/whats-on\/x\/ok" target="_blank" rel="noopener">Safe Event<\/a>/);
});

test('every title links to its limerick.ie page in a new tab', t => {
    const { page } = build(t, EVENTS);
    const links = [...page.matchAll(/<h3 class="headline"><a href="([^"]+)" target="_blank" rel="noopener">/g)].map(m => m[1]);
    assert.equal(links.length, 8);
    assert.ok(links.every(l => l.startsWith('https://www.limerick.ie/discover/whats-on/')));
});

test('the page has the front page link, the credit and no source descriptions or images', t => {
    const { page } = build(t, EVENTS.map(e => ({ ...e, description: 'COPIED-DESCRIPTION', image: 'https://www.limerick.ie/a.png' })));
    assert.match(page, /<a href="index\.html">&larr; Front page<\/a>/);
    assert.match(text(page), /Event listings from Limerick\.ie, Limerick City and County Council\. Check with the organiser before you go\./);
    assert.doesNotMatch(page, /COPIED-DESCRIPTION|<img|a\.png/);
});

test('with no events, the page says so and still has the credit', t => {
    for (const events of [[], null]) {
        const { page } = build(t, events);
        assert.match(page, /No events listed at the moment\./);
        assert.match(text(page), /Event listings from Limerick\.ie/);
    }
});

test('the data file is copied for the front page box, without the fetcher\'s own notes', t => {
    const { read, site } = build(t, EVENTS);
    const copy = JSON.parse(read('data/events.json'));
    assert.equal(copy.events.length, EVENTS.length);
    assert.equal(copy.source.name, 'Limerick.ie');
    assert.equal(copy.past, undefined);
    const none = build(t, null);
    assert.ok(!fs.existsSync(path.join(none.site, 'data/events.json')));
    assert.ok(site);
});

test('the front page script still compiles (a clashing name once broke the whole page)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length);
    for (const code of scripts) new (require('vm').Script)(code);
});

test('the front page links to What\'s On and holds the weekend box', t => {
    const { read } = build(t, EVENTS);
    const index = read('index.html');
    assert.match(index, /href="whats-on\.html"/);
    assert.match(index, /fetch\('data\/events\.json'/);
});
