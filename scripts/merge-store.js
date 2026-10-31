const fs = require('fs');

/**
 * Three-way merge of data/store.json, story by story, for when master moved on during a run
 * (another commit, or a hand edit such as clearing rewrites). Git's line-based rebase conflicts on that.
 *
 *   node scripts/merge-store.js <base> <ours> <theirs>
 *
 * base: the store this run checked out; ours: the store this run wrote (overwritten with the result);
 * theirs: the store now on master. Entries this run added or changed win; everything else, including
 * entries deleted on master, comes from master.
 */
function mergeStores(base, ours, theirs) {
    const merged = {};
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
        const b = base[key] || {}, o = ours[key] || {}, t = theirs[key] || {};
        const entries = { ...t };
        for (const [id, value] of Object.entries(o)) {
            if (JSON.stringify(value) !== JSON.stringify(b[id])) entries[id] = value;
        }
        // Entries this run removed (such as old articles pruned) stay removed
        for (const id of Object.keys(b)) {
            if (!(id in o) && JSON.stringify(b[id]) === JSON.stringify(t[id])) delete entries[id];
        }
        merged[key] = entries;
    }
    return merged;
}

if (require.main === module) {
    const [basePath, oursPath, theirsPath] = process.argv.slice(2);
    const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
    const merged = mergeStores(read(basePath), read(oursPath), read(theirsPath));
    fs.writeFileSync(oursPath, JSON.stringify(merged, null, 2));
    console.log(`✓ Merged store: ${Object.keys(merged.articles || {}).length} articles, ${Object.keys(merged.rewritten || {}).length} rewritten`);
}

module.exports = { mergeStores };
