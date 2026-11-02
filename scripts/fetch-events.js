require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { parseStringPromise } = require('xml2js');

// What's On: event listings from Limerick City and County Council (limerick.ie, the only source; its
// robots.txt allows this). We keep facts only (title, dates, place, price, link) and send readers to the
// council's page. No descriptions or pictures are copied, and no AI is involved.
const FEED = 'https://www.limerick.ie/discover/whats-on/browse/feed';
const EVENT_PREFIX = 'https://www.limerick.ie/discover/whats-on/';
const OUT = () => process.env.EVENTS_PATH || path.join(__dirname, '..', 'data', 'events.json');
const USER_AGENT = 'The061/1.0 (+https://jimcottam1.github.io/the-061/)';
const MAX_PAGE_FETCHES = 40; // new event pages per run
const pauseMs = () => (process.env.EVENTS_PAUSE_MS === undefined || process.env.EVENTS_PAUSE_MS === '' ? 1000 : Number(process.env.EVENTS_PAUSE_MS));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const get = async url => {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
};

/** Feed items worth looking at: not "PRIVATE:" or "Test" entries, and only pages under /discover/whats-on/ (the rest are council meetings and business items). */
function feedItems(xml) {
    return parseStringPromise(xml, { explicitArray: false, trim: true }).then(doc => {
        const raw = doc?.rss?.channel?.item;
        if (!raw) throw new Error('Unrecognised events feed (no items)');
        const items = [].concat(raw).map(item => ({
            id: String(item.guid?._ ?? item.guid ?? '').trim(),
            title: String(item.title ?? '').replace(/\s+/g, ' ').trim(),
            url: String(item.link ?? '').trim()
        }));
        return items.filter(item => item.id && item.title && item.url.startsWith(EVENT_PREFIX)
            && !/^private:/i.test(item.title) && !/^test$/i.test(item.title));
    });
}

/** "2026-08-25T20:00:00+0100" to an ISO instant; a date with no time is an all-day date. */
function parseDate(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { iso: `${text}T00:00:00.000Z`, allDay: true };
    const ms = Date.parse(text.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isNaN(ms) ? null : { iso: new Date(ms).toISOString(), allDay: false };
}

function findEvent(node) {
    if (Array.isArray(node)) return node.map(findEvent).find(Boolean) || null;
    if (!node || typeof node !== 'object') return null;
    const type = [].concat(node['@type'] || []);
    if (type.includes('Event')) return node;
    return findEvent(node['@graph']);
}

/** Dates from the page's JSON-LD, and place and price from the labelled boxes at the foot of the page. */
function parsePage(html) {
    const $ = cheerio.load(html);
    let ld = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        if (ld) return;
        try { ld = findEvent(JSON.parse($(el).contents().text())); } catch { /* not valid JSON: try the next one */ }
    });
    const start = parseDate(ld?.startDate);
    if (!start) return null;
    const end = parseDate(ld.endDate);

    const labelled = label => {
        const el = $('.field__label').filter((_, e) => $(e).text().trim() === label).first();
        return el.nextAll('.field').first().find('.field__item').first().text().replace(/\s+/g, ' ').trim();
    };
    const region = labelled('Location');
    const venue = $('.field--name-field-address a').first().text().replace(/\s+/g, ' ').trim() || String(ld.location?.name || '').trim();
    const place = venue && region && !venue.includes(region) ? `${venue}, ${region}` : venue || region;
    const price = labelled('Price(s)');

    return {
        start: start.iso,
        ...(end && { end: end.iso }),
        ...(start.allDay && { allDay: true }),
        ...(place && { place }),
        ...(price && { price, ...(/^free$/i.test(price) && { free: true }) })
    };
}

function readCache() {
    try {
        const old = JSON.parse(fs.readFileSync(OUT(), 'utf8'));
        return {
            events: new Map((old.events || []).map(e => [e.id, e])),
            past: new Set(old.past || [])
        };
    } catch {
        return { events: new Map(), past: new Set() };
    }
}

async function fetchEvents() {
    console.log('🎟️  What\'s On from limerick.ie\n');
    const items = await feedItems(await get(FEED));
    const cache = readCache();
    const now = Date.now();
    const isOver = e => Date.parse(e.end || e.start) < now;

    const events = [];
    const past = [];
    let fetched = 0;
    for (const item of items) {
        if (cache.past.has(item.id)) { past.push(item.id); continue; }
        let event = cache.events.get(item.id);
        if (!event?.start) {
            if (fetched >= MAX_PAGE_FETCHES) continue; // the rest wait for the next run
            if (fetched++) await sleep(pauseMs());
            try {
                const details = parsePage(await get(item.url));
                if (!details) { console.log(`  no dates on ${item.url}`); continue; }
                event = { id: item.id, title: item.title, url: item.url, ...details };
            } catch (error) {
                console.log(`  skipped ${item.url}: ${error.message}`);
                continue; // not cached, so the next run tries again
            }
        }
        if (isOver(event)) { past.push(item.id); continue; }
        events.push(event);
    }
    events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

    const out = {
        updatedAt: new Date().toISOString(),
        source: { name: 'Limerick.ie', url: 'https://www.limerick.ie/discover/whats-on' },
        events,
        // Ids still in the feed that are over: remembered so their pages aren't fetched again
        past
    };
    fs.mkdirSync(path.dirname(OUT()), { recursive: true });
    fs.writeFileSync(OUT(), JSON.stringify(out, null, 2));
    console.log(`✓ ${events.length} events kept (${fetched} pages fetched, ${items.length} listed in the feed)`);
    return out;
}

if (require.main === module) {
    fetchEvents()
        .then(() => process.exit(0))
        // Never fail the whole run over this page: keep the last good file and carry on
        .catch(error => { console.error(`✗ Events: ${error.message}`); process.exit(0); });
}

module.exports = { fetchEvents, parsePage };
