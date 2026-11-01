const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { fixture, mockFetch, useStore, loadScript, freezeClock, quiet } = require('./helpers');

const NOW = '2026-11-01T12:00:00.000Z';
const OUT = process.env.GAA_FIXTURES_PATH;

async function run(t, answer) {
    quiet(t);
    freezeClock(t, NOW);
    fs.rmSync(OUT, { force: true });
    useStore();
    mockFetch([[/limerickgaa\.ie\/feed/, answer]]);
    return loadScript('fetch-gaa-fixtures').fetchGaaFixtures();
}

test('GAA results posts are split into competitions and their matches', async t => {
    await run(t, fixture('feed-gaa.xml'));
    const out = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    assert.equal(out.results.length, 1);
    const results = out.results[0];
    assert.equal(results.title, 'Limerick GAA Sunday Club Results');
    assert.equal(results.day, 'Sunday 1st November');
    assert.equal(results.link, 'https://limerickgaa.ie/limerick-gaa-sunday-club-results-27/');
    assert.deepEqual(results.competitions, [
        { name: 'Irish Wire Products Ltd, Senior Football Championship Final', matches: ['Fr Casey 0-16 Kildimo/Pallaskenry 2-08'] },
        { name: 'Woodlands House Hotel Adare, Junior C Football Championship Final', matches: ['Murroe/Boher 1-13 Dromcollogher/Broadford 0-07'] },
        { name: 'Premier U21 Hurling Championship Group 2', matches: ['Mungret/St Pauls 1-17 Doon 1-16', 'Na Piarsaigh 3-21 Bruff 1-09'] },
        { name: 'U21 C Hurling Championship Group 1 Round 3', matches: ['Tory Gaels 1-16 Caherline 1-16'] }
    ]);
});

test('GAA fixtures over 3 days old and posts that are neither results nor fixtures are left out', async t => {
    await run(t, fixture('feed-gaa.xml'));
    const out = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    assert.deepEqual(out.fixtures.map(f => f.title), ['Limerick GAA Sunday Club Fixtures']);
    assert.deepEqual(out.fixtures[0].competitions[0].matches, ['St Kieran’s v Cappamore, Cappamore, 11.30am']);
});

test('a failed GAA feed throws and leaves the last file alone', async t => {
    await assert.rejects(run(t, { status: 503 }), /HTTP 503/);
    assert.ok(!fs.existsSync(OUT));
});
