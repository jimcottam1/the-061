// Dates, grouping and wording for the What's On page. Everything is worked out in Irish time
// (Europe/Dublin), so an event at 00:30 on a summer Saturday is a Saturday event even though it is
// still Friday in UTC.
const TZ = 'Europe/Dublin';
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const LATER_DAYS = 60;
const NEXT_DAYS = 7;
const GROUPS = [
    ['today', 'Today'],
    ['weekend', 'This weekend'],
    ['week', 'Next 7 days'],
    ['later', 'Later']
];

/** "2026-11-05": the Irish calendar day of an instant. */
const dayKey = date => DAY.format(date);

function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for a day key. */
const weekday = key => new Date(`${key}T00:00:00Z`).getUTCDay();

/** "Thursday 5 November" */
function dayName(date) {
    return date.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
}

/** "8pm", "8.30pm", "12.15am" */
function clock(date) {
    const [h, m] = CLOCK.format(date).split(':').map(Number);
    const hour = h % 12 || 12;
    return `${hour}${m ? `.${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** The days an event covers, as Irish day keys. */
function span(event) {
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : start;
    return { start, end, startDay: dayKey(start), endDay: dayKey(end) };
}

/** Where the coming weekend (Friday to Sunday) starts and ends, from a day key. A weekend under way has only its remaining days. */
function weekendOf(today) {
    const dow = weekday(today);
    const sunday = addDays(today, (7 - dow) % 7);
    const start = dow === 0 || dow >= 5 ? addDays(today, 1) : addDays(today, 5 - dow);
    return { start, end: sunday };
}

/**
 * Sort events into { today, weekend, week, later } for `now`. Events already over (by Irish day) are
 * left out, as are events starting more than 60 days away. An event under way goes under Today.
 */
function groupEvents(events, now = new Date()) {
    const today = dayKey(now);
    const weekend = weekendOf(today);
    const weekEnd = addDays(today, NEXT_DAYS);
    const laterEnd = addDays(today, LATER_DAYS);
    const groups = { today: [], weekend: [], week: [], later: [] };

    for (const event of events) {
        if (!event || Number.isNaN(Date.parse(event.start))) continue;
        const { startDay, endDay } = span(event);
        if (endDay < today) continue;
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

/** When an event happens, for the page: "Thursday 5 November, 8pm to 11.30pm" or "Until Sunday 10 January". */
function whenText(event, now = new Date()) {
    const { start, end, startDay, endDay } = span(event);
    if (startDay < dayKey(now)) return `Until ${dayName(end)}`;
    const time = event.allDay ? '' : `, ${clock(start)}`;
    if (!event.end || end.getTime() === start.getTime()) return `${dayName(start)}${time}`;
    if (startDay === endDay) return `${dayName(start)}${time}${event.allDay ? '' : ` to ${clock(end)}`}`;
    return `${dayName(start)}${time}, to ${dayName(end)}`;
}

module.exports = { TZ, GROUPS, dayKey, addDays, weekendOf, groupEvents, whenText, dayName, clock };
