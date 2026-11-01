require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Limerick GAA posts club results and fixtures as lists ("Limerick GAA Monday Club Results:"). The
// scraper skips them as stories; this turns them into a results-and-fixtures box for the Sport section.
const FEED = 'https://limerickgaa.ie/feed/';
const OUT = process.env.GAA_FIXTURES_PATH || path.join(__dirname, '..', 'data', 'gaa-fixtures.json');
const RESULTS_DAYS = 7;
const FIXTURES_DAYS = 3;
const KEEP = 2; // posts of each kind

const decode = s => s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#8217;|&rsquo;/g, '’').replace(/&#8211;|&ndash;/g, '–').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const tag = (block, name) => decode((block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '').trim();

/** Paragraphs of the post body as lists of lines; the first is the title and date. */
function paragraphs(html) {
    return (html.match(/<p>([\s\S]*?)<\/p>/g) || [])
        .map(p => p.replace(/<img[^>]*>/g, '').replace(/<\/?p>/g, '').split(/<br\s*\/?>/i)
            .map(line => decode(line.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().replace(/\.$/, ''))
            .filter(Boolean))
        .filter(lines => lines.length);
}

function parsePost(item) {
    const title = tag(item, 'title').replace(/:$/, '');
    const kind = /results/i.test(title) ? 'results' : /fixtures/i.test(title) ? 'fixtures' : null;
    if (!kind) return null;
    const [first, ...rest] = paragraphs(tag(item, 'content:encoded'));
    // The first paragraph is "Limerick GAA Monday Club Results:" then the day, e.g. "Monday 26th October"
    const day = (first || []).find(line => !/limerick gaa/i.test(line)) || '';
    // A line with a score ("1-20") or " v " is a match; any other line starts a new competition,
    // since several competitions can share one paragraph
    const isMatch = line => /\d+-\d+/.test(line) || /\sv\s/i.test(line);
    const competitions = [];
    for (const line of rest.flat()) {
        if (isMatch(line) && competitions.length) competitions[competitions.length - 1].matches.push(line);
        else if (!isMatch(line)) competitions.push({ name: line, matches: [] });
    }
    for (let i = competitions.length - 1; i >= 0; i--) if (!competitions[i].matches.length) competitions.splice(i, 1);
    if (!competitions.length) return null;
    return { kind, title, day, published: new Date(tag(item, 'pubDate')).toISOString(), link: tag(item, 'link'), competitions };
}

async function fetchGaaFixtures() {
    console.log('🏑 Limerick GAA results and fixtures\n');
    const res = await fetch(FEED, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = (await res.text()).match(/<item>[\s\S]*?<\/item>/g) || [];

    const now = Date.now();
    const posts = items.map(parsePost).filter(Boolean);
    const recent = (kind, days) => posts
        .filter(p => p.kind === kind && now - new Date(p.published).getTime() <= days * 86400000)
        .sort((a, b) => b.published.localeCompare(a.published))
        .slice(0, KEEP);

    const out = {
        updatedAt: new Date().toISOString(),
        source: { name: 'Limerick GAA', url: 'https://limerickgaa.ie/' },
        results: recent('results', RESULTS_DAYS),
        fixtures: recent('fixtures', FIXTURES_DAYS)
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(`✓ ${out.results.length} results posts, ${out.fixtures.length} fixtures posts`);
}

if (require.main === module) {
    fetchGaaFixtures()
        .then(() => process.exit(0))
        // Never fail the whole run over this box: keep yesterday's file and carry on
        .catch(error => { console.error(`✗ GAA fixtures: ${error.message}`); process.exit(0); });
}

module.exports = { fetchGaaFixtures };
