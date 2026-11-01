// Test helpers. No test touches the network, Gemini or NewsAPI: node-fetch, scripts/lib/gemini and newsapi
// are replaced before any script loads, and each test gets its own store file in a temporary folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'the-061-test-'));
const SCRIPTS = path.join(__dirname, '..', 'scripts') + path.sep;

// Blank the keys and settings before any script runs dotenv (it never overrides a variable that is already
// set), so a local .env can't leak a real key in, and the scripts fall back to their built-in defaults.
for (const name of ['GEMINI_API_KEY', 'NEWSAPI_KEY', 'RSS_FEEDS', 'LIMERICK_KEYWORDS', 'MIN_ARTICLE_LENGTH',
    'MAX_ARTICLE_AGE_DAYS', 'MAX_DAILY_REWRITES', 'MAX_IMAGE_FETCHES', 'MAX_SECTION_CLASSIFICATIONS', 'GEMINI_MODEL', 'SITE_URL']) {
    process.env[name] = '';
}
process.env.GAA_FIXTURES_PATH = path.join(TMP, 'gaa-fixtures.json');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

/** Put a fake module in require's cache, so every later require() of it gets `exports`. */
function fake(request, exports) {
    const file = require.resolve(request);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
    return file;
}

// ---- node-fetch ----
let routes = [];
let requests = [];
fake('node-fetch', async (url, options = {}) => {
    requests.push({ url, headers: options.headers || {} });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`No fixture for ${url}`);
    let answer = typeof route[1] === 'function' ? route[1](url) : route[1];
    if (answer instanceof Error) throw answer;
    if (typeof answer === 'string') answer = { status: 200, body: answer };
    const status = answer.status ?? 200;
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: answer.statusText || '',
        text: async () => String(answer.body ?? '')
    };
});

/**
 * Answer node-fetch requests: routes = [[/url pattern/, answer], ...]. An answer is a body string,
 * { status, body }, an Error (a network failure), or (url) => any of those. An unmatched URL rejects.
 * Returns the list of requests made, as { url, headers }.
 */
function mockFetch(newRoutes) {
    routes = newRoutes;
    requests = [];
    return requests;
}

// ---- Gemini ----
let answerPrompt = null;
let prompts = [];
const GEMINI = fake('../scripts/lib/gemini', {
    MODEL: 'test-model',
    generate: async prompt => {
        if (!answerPrompt) throw new Error('Gemini was called without mockGemini()');
        prompts.push(prompt);
        return answerPrompt(prompt);
    }
});

/**
 * Answer Gemini prompts with answer(prompt) => text (throw to simulate an API error).
 * Returns the list of prompts sent.
 */
function mockGemini(answer) {
    answerPrompt = answer;
    prompts = [];
    return prompts;
}

// ---- NewsAPI: tests never construct it (NEWSAPI_KEY is blank), and fail if they do ----
fake('newsapi', class { constructor() { throw new Error('NewsAPI must not be used in tests'); } });

// ---- Store ----
let storeCount = 0;

/**
 * Start a fresh store file holding `data` and forget every loaded script, so the next loadScript()
 * reads this store. Returns { path, read() } where read() parses the file as saved.
 */
function useStore(data = {}) {
    const file = path.join(TMP, `store-${++storeCount}.json`);
    fs.writeFileSync(file, JSON.stringify({ meta: {}, articles: {}, rewritten: {}, ...data }));
    process.env.STORE_PATH = file;
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(SCRIPTS) && key !== GEMINI) delete require.cache[key];
    }
    mockFetch([]);
    mockGemini(null);
    return { path: file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

/** Load a script (e.g. 'rewrite-articles' or 'lib/store'); call useStore() first. */
function loadScript(name) {
    return require(`../scripts/${name}`);
}

/** Freeze the clock (Date only) at an ISO time for the rest of this test. */
function freezeClock(t, iso) {
    t.mock.timers.reset(); // calling it again within one test just moves the clock
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) });
}

/** A temporary folder for a test's output (such as a built site). */
const tempDir = name => fs.mkdtempSync(path.join(TMP, `${name}-`));

/** Silence the scripts' progress logging inside a test (errors still show). */
function quiet(t) {
    t.mock.method(console, 'log', () => {});
}

module.exports = { fixture, mockFetch, mockGemini, useStore, loadScript, freezeClock, tempDir, quiet, TMP };
