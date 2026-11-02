// What's On logic shared by the builder (scripts/lib/events.js), whats-on.html and the front page box, so
// there is one copy. Plain script: a browser gets window.EventsCore, Node gets module.exports.
// Everything is worked out in Irish time (Europe/Dublin), so an event at 00:30 on a summer Saturday
// is a Saturday event even though it is still Friday in UTC.
(function (root) {
    const TZ = 'Europe/Dublin';
    const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

    const LATER_DAYS = 60;
    const NEXT_DAYS = 7;
    const BOX_SIZE = 5;
    const SOURCE_URL = 'https://www.limerick.ie/discover/whats-on';
    const GROUPS = [
        ['today', 'Today'],
        ['weekend', 'This weekend'],
        ['week', 'Next 7 days'],
        ['later', 'Later']
    ];

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    /** Only http(s) URLs go into href attributes. */
    function safeUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
        } catch {
            return null;
        }
    }

    /** "2026-11-05": the Irish calendar day of an instant. */
    const dayKey = date => DAY.format(date);

    function addDays(key, n) {
        const [y, m, d] = key.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
    }

    /** 0 = Sunday ... 6 = Saturday, for a day key. */
    const weekday = key => new Date(`${key}T00:00:00Z`).getUTCDay();

    /** "Thursday, 5 November" */
    function dayName(date) {
        return date.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
    }

    /** "8pm", "8.30pm", "12.15am" */
    function clock(date) {
        const [h, m] = CLOCK.format(date).split(':').map(Number);
        return `${h % 12 || 12}${m ? `.${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
    }

    function span(event) {
        const start = new Date(event.start);
        const end = event.end ? new Date(event.end) : start;
        return { start, end, startDay: dayKey(start), endDay: dayKey(end) };
    }

    /**
     * Is the event over? One with an end time is over when that time passes. One with no end time, or an
     * all-day one (a date with no time), is over only when its last Irish day has finished.
     */
    function isOver(event, now = new Date()) {
        const end = Date.parse(event.end || event.start);
        if (Number.isNaN(end)) return true;
        if (event.end && !event.allDay) return end < now.getTime();
        return dayKey(new Date(end)) < dayKey(now);
    }

    /** The coming Friday to Sunday, from a day key. Today is left out: a weekend under way has only its remaining days. */
    function weekendOf(today) {
        const dow = weekday(today);
        const sunday = addDays(today, (7 - dow) % 7);
        const start = dow === 0 || dow >= 5 ? addDays(today, 1) : addDays(today, 5 - dow);
        return { start, end: sunday };
    }

    /**
     * Sort events into { today, weekend, week, later } for `now`. Events already over are left out, as are
     * events starting more than 60 days away. An event under way goes under Today.
     */
    function groupEvents(events, now = new Date()) {
        const today = dayKey(now);
        const weekend = weekendOf(today);
        const weekEnd = addDays(today, NEXT_DAYS);
        const laterEnd = addDays(today, LATER_DAYS);
        const groups = { today: [], weekend: [], week: [], later: [] };

        for (const event of events) {
            if (!event || Number.isNaN(Date.parse(event.start)) || isOver(event, now)) continue;
            const { startDay } = span(event);
            let group = null;
            if (startDay <= today) group = 'today';
            else if (startDay >= weekend.start && startDay <= weekend.end) group = 'weekend';
            else if (startDay <= weekEnd) group = 'week';
            else if (startDay <= laterEnd) group = 'later';
            if (group) groups[group].push(event);
        }

        const begins = e => Date.parse(e.start);
        for (const list of Object.values(groups)) list.sort((a, b) => begins(a) - begins(b));
        // Under way since an earlier day: after the ones starting today
        groups.today.sort((a, b) => (dayKey(new Date(a.start)) < today) - (dayKey(new Date(b.start)) < today) || begins(a) - begins(b));
        return groups;
    }

    /** When an event happens, for the page: "Thursday, 5 November, 8pm to 11.30pm" or "Until Sunday, 10 January". */
    function whenText(event, now = new Date()) {
        const { start, end, startDay, endDay } = span(event);
        if (startDay < dayKey(now)) return `Until ${dayName(end)}`;
        const time = event.allDay ? '' : `, ${clock(start)}`;
        if (!event.end || end.getTime() === start.getTime()) return `${dayName(start)}${time}`;
        if (startDay === endDay) return `${dayName(start)}${time}${event.allDay ? '' : ` to ${clock(end)}`}`;
        return `${dayName(start)}${time}, to ${dayName(end)}`;
    }

    const priceOf = event => (event.free ? 'Free' : event.price);

    function entryHtml(event, now) {
        const url = safeUrl(event.url);
        const title = escapeHtml(event.title);
        const meta = [event.place, priceOf(event)].filter(Boolean).map(escapeHtml).join(' &middot; ');
        return `
            <article class="archive-entry no-photo event-entry">
                <div>
                    <h3 class="headline">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${title}</a>` : title}</h3>
                    <p class="event-when">${escapeHtml(whenText(event, now))}</p>
                    ${meta ? `<p class="event-meta">${meta}</p>` : ''}
                </div>
            </article>`;
    }

    /** The What's On page's list: groups under their headings, or a line saying there is nothing. */
    function listHtml(events, now = new Date()) {
        const groups = groupEvents(Array.isArray(events) ? events : [], now);
        const days = GROUPS.filter(([key]) => groups[key].length).map(([key, heading]) => `
        <section class="archive-day">
            <h2 class="archive-date">${escapeHtml(heading)}</h2>
            ${groups[key].map(e => entryHtml(e, now)).join('')}
        </section>`).join('');
        return days || '<p class="notice">No events listed at the moment.</p>';
    }

    /** Up to 5 events starting on the coming Friday to Sunday, else the next 5; null when there are none. */
    function pickWeekend(events, now = new Date()) {
        const today = dayKey(now);
        const dow = weekday(today);
        const sunday = addDays(today, (7 - dow) % 7);
        const from = dow === 0 || dow >= 5 ? today : addDays(today, 5 - dow);
        const upcoming = (Array.isArray(events) ? events : [])
            .filter(e => e && e.title && !Number.isNaN(Date.parse(e.start)) && !isOver(e, now))
            .filter(e => dayKey(new Date(e.start)) >= today) // ones already under way are on the What's On page
            .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
        const weekend = upcoming.filter(e => { const day = dayKey(new Date(e.start)); return day >= from && day <= sunday; });
        if (weekend.length) return { heading: "What's on this weekend", events: weekend.slice(0, BOX_SIZE) };
        return upcoming.length ? { heading: "What's on", events: upcoming.slice(0, BOX_SIZE) } : null;
    }

    /** The front page box; an empty string when there is nothing to show. */
    function boxHtml(events, now = new Date()) {
        const picked = pickWeekend(events, now);
        if (!picked) return '';
        const items = picked.events.map(e => {
            const start = new Date(e.start);
            const when = `${start.toLocaleDateString('en-IE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })}${e.allDay ? '' : ', ' + clock(start)}`;
            const line = [when, e.place, priceOf(e)].filter(Boolean).map(escapeHtml).join(' &middot; ');
            const url = safeUrl(e.url);
            const title = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a>` : escapeHtml(e.title);
            return `<li>${title}<span class="event-line">${line}</span></li>`;
        }).join('');
        return `
                <section class="events-box" aria-label="${escapeHtml(picked.heading)}">
                    <div class="events-head"><h2>${escapeHtml(picked.heading)}</h2><a href="whats-on.html">All events &rarr;</a></div>
                    <ul>${items}</ul>
                    <p class="events-credit">Listings from <a href="${SOURCE_URL}" target="_blank" rel="noopener">Limerick.ie</a></p>
                </section>`;
    }

    const api = { TZ, GROUPS, SOURCE_URL, escapeHtml, safeUrl, dayKey, addDays, weekendOf, isOver, groupEvents, whenText, dayName, clock, pickWeekend, listHtml, boxHtml };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EventsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
