// The What's On logic shared by the builder, whats-on.html and the front page box (public/events-core.js).
// Every case passes `now` in, so nothing here depends on today's date.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const core = require('../public/events-core.js');

const at = iso => new Date(iso);
const ev = (id, start, extra = {}) => ({ id, title: `Event ${id}`, url: `https://www.limerick.ie/discover/whats-on/x/${id}`, start, ...extra });
const ids = list => list.map(e => e.id);
const grouped = (events, now) => Object.fromEntries(Object.entries(core.groupEvents(events, at(now))).map(([k, v]) => [k, ids(v)]));
const box = (events, now) => { const p = core.pickWeekend(events, at(now)); return p && { heading: p.heading, ids: ids(p.events) }; };

// November 2026: Thu 5, Fri 6, Sat 7, Sun 8, Mon 9, Sat 14 (Irish time is GMT)
const WINTER = [
    ev('thu', '2026-11-05T20:00:00.000Z'),
    ev('fri', '2026-11-06T18:00:00.000Z'),
    ev('sat', '2026-11-07T10:00:00.000Z'),
    ev('sun', '2026-11-08T12:00:00.000Z'),
    ev('mon', '2026-11-09T10:00:00.000Z'),
    ev('nextsat', '2026-11-14T10:00:00.000Z')
];

test('on a Friday the weekend is today, Saturday and Sunday', () => {
    const now = '2026-11-06T12:00:00.000Z';
    assert.deepEqual(box(WINTER, now), { heading: "What's on this weekend", ids: ['fri', 'sat', 'sun'] });
    assert.deepEqual(grouped(WINTER, now), { today: ['fri'], weekend: ['sat', 'sun'], week: ['mon'], later: ['nextsat'] });
});

test('on a Saturday the weekend is what is left of it', () => {
    const now = '2026-11-07T12:00:00.000Z';
    assert.deepEqual(box(WINTER, now), { heading: "What's on this weekend", ids: ['sat', 'sun'] });
    assert.deepEqual(grouped(WINTER, now), { today: ['sat'], weekend: ['sun'], week: ['mon', 'nextsat'], later: [] });
});

test('on a Sunday morning only today is left of the weekend, and next weekend is not this one', () => {
    const now = '2026-11-08T09:00:00.000Z';
    assert.deepEqual(box(WINTER, now), { heading: "What's on this weekend", ids: ['sun'] });
    assert.deepEqual(grouped(WINTER, now), { today: ['sun'], weekend: [], week: ['mon', 'nextsat'], later: [] });
});

test('on a Monday the weekend is the coming Friday to Sunday', () => {
    const now = '2026-11-02T12:00:00.000Z';
    assert.deepEqual(box(WINTER, now), { heading: "What's on this weekend", ids: ['fri', 'sat', 'sun'] });
    assert.deepEqual(grouped(WINTER, now), { today: [], weekend: ['fri', 'sat', 'sun'], week: ['thu', 'mon'], later: ['nextsat'] });
});

test('summer: 23:30 UTC on Sunday is already Monday in Ireland, so the weekend is the next one', () => {
    const now = '2026-07-12T23:30:00.000Z';
    const summer = [
        ev('sunfair', '2026-07-12T10:00:00.000Z'), // Sunday: over
        ev('mon', '2026-07-13T10:00:00.000Z'),
        ev('fri', '2026-07-17T18:00:00.000Z'),
        ev('sat', '2026-07-18T10:00:00.000Z')
    ];
    assert.deepEqual(grouped(summer, now), { today: ['mon'], weekend: ['fri', 'sat'], week: [], later: [] });
    assert.deepEqual(box(summer, now), { heading: "What's on this weekend", ids: ['fri', 'sat'] });
});

test('a weekend with nothing on shows the next events instead, and no events shows nothing', () => {
    const now = '2026-11-04T12:00:00.000Z'; // Wednesday
    const quiet = [ev('mon', '2026-11-09T10:00:00.000Z'), ev('tue', '2026-11-10T10:00:00.000Z')];
    assert.deepEqual(box(quiet, now), { heading: "What's on", ids: ['mon', 'tue'] });
    assert.equal(box([], now), null);
    assert.equal(core.boxHtml([], at(now)), '');
    assert.equal(core.boxHtml(undefined, at(now)), '');
    assert.equal(core.boxHtml([ev('past', '2026-11-01T10:00:00.000Z')], at(now)), '');
});

test('the box shows at most 5 events', () => {
    const many = Array.from({ length: 8 }, (_, i) => ev(`e${i}`, `2026-11-07T${String(8 + i).padStart(2, '0')}:00:00.000Z`));
    assert.equal(box(many, '2026-11-02T12:00:00.000Z').ids.length, 5);
});

test('across the clocks going back (25 October 2026) days follow Irish time', () => {
    assert.equal(core.dayKey(at('2026-10-25T23:30:00.000Z')), '2026-10-25'); // 23:30 GMT
    assert.equal(core.dayKey(at('2026-10-24T23:30:00.000Z')), '2026-10-25'); // 00:30 BST
    assert.equal(core.dayKey(at('2026-10-26T00:00:00.000Z')), '2026-10-26');
    assert.equal(core.clock(at('2026-10-25T00:30:00.000Z')), '1.30am'); // BST
    assert.equal(core.clock(at('2026-10-25T01:30:00.000Z')), '1.30am'); // GMT, the same hour again
    const now = '2026-10-24T23:30:00.000Z'; // Sunday 00:30 in Ireland
    const events = [ev('late', '2026-10-25T23:30:00.000Z'), ev('monday', '2026-10-26T00:00:00.000Z')];
    assert.deepEqual(grouped(events, now), { today: ['late'], weekend: [], week: ['monday'], later: [] });
});

test('across the clocks going forward (28 March 2027) days follow Irish time', () => {
    assert.equal(core.dayKey(at('2027-03-27T23:30:00.000Z')), '2027-03-27'); // 23:30 GMT
    assert.equal(core.dayKey(at('2027-03-28T23:30:00.000Z')), '2027-03-29'); // 00:30 Monday, IST
    assert.equal(core.clock(at('2027-03-28T01:30:00.000Z')), '2.30am'); // IST
    const now = '2027-03-27T12:00:00.000Z'; // Saturday
    const events = [ev('early', '2027-03-28T00:30:00.000Z'), ev('monday', '2027-03-28T23:30:00.000Z')];
    assert.deepEqual(grouped(events, now), { today: [], weekend: ['early'], week: ['monday'], later: [] });
});

test('an event is over when its end time passes, not at the end of its day', () => {
    const e = ev('x', '2026-11-02T10:00:00.000Z', { end: '2026-11-02T12:00:00.000Z' });
    assert.equal(core.isOver(e, at('2026-11-02T11:59:00.000Z')), false);
    assert.equal(core.isOver(e, at('2026-11-02T12:01:00.000Z')), true);
    assert.deepEqual(ids(core.groupEvents([e], at('2026-11-02T13:00:00.000Z')).today), []);
    assert.equal(core.boxHtml([e], at('2026-11-02T13:00:00.000Z')), '');
    // No end time: on until the day is out
    assert.equal(core.isOver(ev('y', '2026-11-02T10:00:00.000Z'), at('2026-11-02T20:00:00.000Z')), false);
    assert.equal(core.isOver(ev('y', '2026-11-02T10:00:00.000Z'), at('2026-11-03T00:30:00.000Z')), true);
});

test('an all-day event is over only when its Irish day ends', () => {
    const day = ev('d', '2026-07-11T00:00:00.000Z', { end: '2026-07-11T00:00:00.000Z', allDay: true });
    assert.equal(core.isOver(day, at('2026-07-11T15:00:00.000Z')), false, 'UTC midnight has passed, the day has not');
    assert.equal(core.isOver(day, at('2026-07-11T22:30:00.000Z')), false, '23:30 in Ireland');
    assert.equal(core.isOver(day, at('2026-07-11T23:30:00.000Z')), true, '00:30 the next day');
    assert.equal(core.whenText(day, at('2026-07-11T09:00:00.000Z')), 'Saturday, 11 July');
});

test('wording: times, ranges and events under way', () => {
    const now = at('2026-11-02T12:00:00.000Z');
    assert.equal(core.whenText(ev('a', '2026-11-05T20:00:00.000Z', { end: '2026-11-05T23:30:00.000Z' }), now), 'Thursday, 5 November, 8pm to 11.30pm');
    assert.equal(core.whenText(ev('b', '2026-11-05T09:00:00.000Z', { end: '2026-11-08T17:00:00.000Z' }), now), 'Thursday, 5 November, 9am, to Sunday, 8 November');
    assert.equal(core.whenText(ev('c', '2026-09-01T09:00:00.000Z', { end: '2027-01-10T17:00:00.000Z' }), now), 'Until Sunday, 10 January');
});

test('everything is escaped and only http(s) links are used, in the list and in the box', () => {
    const bad = ev('bad', '2026-11-03T10:00:00.000Z', { title: '<script>alert(1)</script> & "Q"', place: '<img src=x onerror=alert(2)>', price: '"><b>€5</b>', url: 'javascript:alert(3)' });
    const now = at('2026-11-02T12:00:00.000Z');
    for (const html of [core.listHtml([bad], now), core.boxHtml([bad], now)]) {
        assert.doesNotMatch(html, /<script>|<img src=x|<b>€5|javascript:/);
        assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Q&quot;/);
    }
    assert.match(core.boxHtml([ev('ok', '2026-11-03T10:00:00.000Z')], now), /Listings from <a href="https:\/\/www\.limerick\.ie\/discover\/whats-on" target="_blank" rel="noopener">Limerick\.ie<\/a>/);
    assert.match(core.boxHtml([ev('ok', '2026-11-03T10:00:00.000Z')], now), /href="whats-on\.html">All events/);
});

test('the same file works as a plain browser script', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'events-core.js'), 'utf8'), { window, Intl, URL, Date });
    assert.equal(typeof window.EventsCore.groupEvents, 'function');
    assert.deepEqual([...ids(window.EventsCore.pickWeekend(WINTER, at('2026-11-08T09:00:00.000Z')).events)], ['sun']); // spread: arrays made inside the vm belong to another realm
});

// The front page box spreads its 5 places across the weekend days, one day at a time, then lists them in time order.
const fri = (id, h) => ev(id, `2026-11-06T${h}:00:00.000Z`);
const sat = (id, h) => ev(id, `2026-11-07T${h}:00:00.000Z`);
const sun = (id, h) => ev(id, `2026-11-08T${h}:00:00.000Z`);

test('the box takes Friday, Saturday and Sunday in turn, then lists them in time order', () => {
    const events = [fri('f6', '16'), fri('f5', '15'), fri('f4', '14'), fri('f3', '13'), fri('f2', '12'), fri('f1', '11'),
        sat('s2', '15'), sat('s1', '09'), sun('u1', '20')];
    // Round-robin picks f1, s1, u1, f2, s2
    assert.deepEqual(box(events, '2026-11-04T12:00:00.000Z'), { heading: "What's on this weekend", ids: ['f1', 'f2', 's1', 's2', 'u1'] });
});

test('when the five places run out part-way through a round, Friday gets the earlier turn', () => {
    const events = [fri('f1', '10'), fri('f2', '11'), fri('f3', '12'), sat('s1', '10'), sat('s2', '11'), sat('s3', '12'),
        sun('u1', '10'), sun('u2', '11'), sun('u3', '12')];
    // f1, s1, u1, f2, s2: Sunday's second event misses out
    assert.deepEqual(box(events, '2026-11-04T12:00:00.000Z').ids, ['f1', 'f2', 's1', 's2', 'u1']);
});

test('on a Saturday the box shares its places between Saturday and Sunday only', () => {
    const events = [fri('f1', '11'), sat('s1', '09'), sat('s2', '10'), sat('s3', '11'), sat('s4', '12'), sun('u1', '10'), sun('u2', '11')];
    // s1, u1, s2, u2, s3 (Friday is gone), shown in time order
    assert.deepEqual(box(events, '2026-11-07T08:00:00.000Z').ids, ['s1', 's2', 's3', 'u1', 'u2']);
});

test('when only Friday has events the box fills with Fridays, earliest first', () => {
    const events = ['17', '12', '15', '11', '19', '10', '13'].map(h => fri(`f${h}`, h));
    assert.deepEqual(box(events, '2026-11-04T12:00:00.000Z').ids, ['f10', 'f11', 'f12', 'f13', 'f15']);
});

test('a day with no events is skipped and the others fill its place', () => {
    const events = [fri('f1', '10'), fri('f2', '11'), fri('f3', '12'), sun('u1', '10'), sun('u2', '11'), sun('u3', '12')];
    assert.deepEqual(box(events, '2026-11-04T12:00:00.000Z').ids, ['f1', 'f2', 'f3', 'u1', 'u2']);
});

test('late on a summer Sunday (already Monday in Ireland) the box looks to next weekend', () => {
    const now = '2026-07-05T23:30:00.000Z'; // Mon 6 July, 00:30 in Irish time
    const events = [
        ev('thisSun', '2026-07-05T12:00:00.000Z'),
        ev('f1', '2026-07-10T18:00:00.000Z'), ev('s1', '2026-07-11T10:00:00.000Z'), ev('u1', '2026-07-12T10:00:00.000Z')
    ];
    assert.deepEqual(box(events, now), { heading: "What's on this weekend", ids: ['f1', 's1', 'u1'] });
    assert.deepEqual(box([events[0]], now), null);
});
