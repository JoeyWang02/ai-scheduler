import { state } from './state.js';
import { translations } from './i18n.js';
import { escapeHtml } from './utils.js';
import { translateDynamicText } from './analytics.js';
import { getBuddyGreeting, getChatAvatarSrc, BUDDY_MOOD_EMOJI, STUDY_BUDDIES } from './buddy.js';
import { showModal, toggleTaskComplete } from './scheduler.js';

/* "Today" info band above the calendar — surfaces the daily-execution signal
   (what's next), status (today / overdue counts + next-deadline countdown),
   and the Buddy motivation loop, all from already-cached data. Nothing imports
   this module except app.js, so wiring it to data changes goes through a
   custom `nexus:today-refresh` event (dispatched by loadTasks /
   refreshBuddyState / toggleTaskComplete) rather than imports — no cycles. */

const MAX_ROWS = 3;

// getBuddyGreeting() picks a random line; cache it so the band doesn't reshuffle
// the greeting on every task toggle. Re-generated only when the language flips.
let cachedGreeting = null;

function parseLocal(localDueDate) {
    if (!localDueDate || localDueDate === 'No Deadline') return null;
    const d = new Date(localDueDate.replace(' ', 'T'));
    return isNaN(d.valueOf()) ? null : d;
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function formatCountdown(ms, dict) {
    if (ms < 60 * 60 * 1000) {
        return dict.tbCountdownMin.replace('{n}', Math.max(1, Math.round(ms / 60000)));
    }
    if (ms < 24 * 60 * 60 * 1000) {
        return dict.tbCountdownHour.replace('{n}', Math.round(ms / 3600000));
    }
    return dict.tbCountdownDay.replace('{n}', Math.max(1, Math.round(ms / 86400000)));
}

function computeMetrics() {
    const now = new Date();
    const tasks = state.lastLoadedTasks || [];
    let overdue = 0;
    const todays = [];
    const upcoming = [];
    let next = null;

    tasks.forEach(t => {
        if (t.completed) return;
        const d = parseLocal(t.localDueDate);
        if (!d) return;
        if (sameDay(d, now)) todays.push({ t, d });
        if (d < now) {
            overdue++;
        } else {
            upcoming.push({ t, d });
            if (!next || d < next.d) next = { t, d };
        }
    });

    todays.sort((a, b) => a.d - b.d);
    upcoming.sort((a, b) => a.d - b.d);

    // Agenda prefers today's own tasks; if today is clear, fall back to the
    // soonest upcoming so the band still points somewhere useful.
    const agenda = (todays.length ? todays : upcoming).slice(0, MAX_ROWS);
    return { now, todayCount: todays.length, overdue, next, agenda };
}

function renderBuddyZone(dict) {
    const s = state.lastBuddyState;
    const buddyId = localStorage.getItem('studyBuddy') || 'junimo';
    const buddyName = (STUDY_BUDDIES.find(b => b.id === buddyId) || STUDY_BUDDIES[0]).name;

    const currentLang = localStorage.getItem('appLang') || 'zh';
    if (!cachedGreeting || cachedGreeting.lang !== currentLang) {
        cachedGreeting = { lang: currentLang, text: getBuddyGreeting() };
    }

    let idLine = `<span class="tb-buddy-name">${escapeHtml(buddyName)}</span>`;
    if (s) {
        const moodEmoji = BUDDY_MOOD_EMOJI[s.mood] || BUDDY_MOOD_EMOJI.calm;
        const moodLabel = dict['buddyMood' + s.mood.charAt(0).toUpperCase() + s.mood.slice(1)] || s.mood;
        idLine += `<span class="tb-lv">Lv.${s.level}</span>`
            + `<span class="tb-mood">${moodEmoji} ${escapeHtml(moodLabel)}</span>`;
    }

    return `
        <div class="tb-buddy-row">
            <img class="tb-avatar" src="${getChatAvatarSrc()}" alt="">
            <div class="tb-buddy-id">${idLine}</div>
        </div>
        <p class="tb-greeting">${escapeHtml(cachedGreeting.text)}</p>`;
}

function renderAgendaZone(dict, metrics) {
    const { todayCount, overdue, next, agenda } = metrics;

    const stats = [`<span class="tb-pill">${escapeHtml(dict.tbToday)} ${todayCount}</span>`];
    if (overdue > 0) {
        stats.push(`<span class="tb-pill tb-pill-over">${escapeHtml(dict.tbOverdue)} ${overdue}</span>`);
    }
    if (next) {
        const cd = formatCountdown(next.d - metrics.now, dict);
        stats.push(`<span class="tb-pill tb-pill-next">${escapeHtml(dict.tbNextDue)} ${escapeHtml(cd)}</span>`);
    }

    const head = `
        <div class="tb-agenda-head">
            <span class="tb-agenda-title">${escapeHtml(dict.tbNext)}</span>
            <span class="tb-stats">${stats.join('')}</span>
        </div>`;

    const list = document.createElement('div');
    list.className = 'tb-agenda-list';

    if (!agenda.length) {
        const empty = document.createElement('div');
        empty.className = 'tb-empty';
        empty.textContent = dict.tbEmpty;
        list.appendChild(empty);
    } else {
        const lang = localStorage.getItem('appLang') || 'zh';
        agenda.forEach(({ t }) => {
            const transTitle = translateDynamicText(t.title, 'title', lang);
            const transDesc = translateDynamicText(t.description, 'desc', lang);
            const row = document.createElement('div');
            row.className = 'tb-task';
            row.addEventListener('click', () =>
                showModal(transTitle, t.localDueDate, transDesc, t.id, t.color || '', null, t.dueDate || t.localDueDate));

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'task-complete-checkbox tb-check';
            cb.onclick = (e) => e.stopPropagation();
            cb.onchange = () => toggleTaskComplete(t.id, cb.checked, row);

            const time = document.createElement('span');
            time.className = 'tb-task-time';
            time.textContent = (t.localDueDate && t.localDueDate.length >= 16)
                ? t.localDueDate.substring(11, 16) : '';

            const title = document.createElement('span');
            title.className = 'tb-task-title';
            title.textContent = transTitle;

            row.appendChild(cb);
            row.appendChild(time);
            row.appendChild(title);
            list.appendChild(row);
        });
    }

    const wrap = document.createElement('div');
    wrap.innerHTML = head;
    wrap.appendChild(list);
    return wrap;
}

export function renderTodayBand() {
    const band = document.getElementById('todayBand');
    if (!band) return;
    const lang = localStorage.getItem('appLang') || 'zh';
    const dict = translations[lang];
    const metrics = computeMetrics();

    const buddyEl = document.getElementById('todayBandBuddy');
    if (buddyEl) buddyEl.innerHTML = renderBuddyZone(dict);

    const agendaEl = document.getElementById('todayBandAgenda');
    if (agendaEl) {
        agendaEl.innerHTML = '';
        agendaEl.appendChild(renderAgendaZone(dict, metrics));
    }

    // The band's own height shifts with its content (0–3 rows), which changes
    // how much vertical space the calendar below it gets — nudge FullCalendar
    // to re-measure so it always fills exactly the remainder.
    if (state.calendar) state.calendar.updateSize();
}

export function initTodayBand() {
    document.addEventListener('nexus:today-refresh', renderTodayBand);
    renderTodayBand();
}
