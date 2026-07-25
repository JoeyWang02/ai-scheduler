import { state } from './state.js';
import { translations } from './i18n.js';
import { getChatAvatarSrc, pulseBuddyAvatar } from './buddy.js';
import { pulseBuddyWidget, showBuddyBubble } from './buddyWidget.js';
import { loadTasks, openEditModal } from './scheduler.js';
import { getUserId } from './auth.js';

/* "Companion reminders" — the deadline system, reframed from an alarm that
   nags into a buddy that has your back. Grounded in behavioural psychology:
     - Autonomy (Self-Determination Theory): urgent nudges can be SNOOZED, so
       the user keeps control and doesn't disable reminders out of reactance.
     - Fresh-start effect: a once-a-day BRIEF orients the day and cuts the
       anxiety of an unknown workload.
     - Self-compassion (Neff): OVERDUE tasks get a kind "want to reschedule?"
       reset, never a scolding — kindness re-engages where guilt drives
       avoidance.
     - Notification fatigue: QUIET HOURS hold non-urgent pings at night; the
       in-app time-critical nudge still fires (silent, only if the app is open)
       so a real 30-min deadline is never swallowed.
   Everything is buddy-voiced (pulse + speech bubble) and in-app first; the OS
   notification is a strictly additive extra layer. */

const TIERS = [
    { id: 'headsUp', leadMinutes: 120, notifyOS: false, snoozable: false, messageKey: 'reminderHeadsUpMessage' },
    { id: 'urgent', leadMinutes: 30, notifyOS: true, snoozable: true, messageKey: 'reminderUrgentMessage' },
];

const ENABLED_KEY = 'remindersEnabled';
const NOTIFIED_KEY = 'notifiedReminders';
const SNOOZE_KEY = 'reminderSnoozes';
const OVERDUE_KEY = 'overdueNotified';
const BRIEF_KEY = 'lastDailyBriefDate';
const CHECK_INTERVAL_MS = 60 * 1000;
const REFRESH_TASKS_INTERVAL_MS = 5 * 60 * 1000;
const SNOOZE_MS = 15 * 60 * 1000;

// Quiet hours: hold non-urgent pings between 22:00 and 07:00 local.
const QUIET_START = 22;
const QUIET_END = 7;

let checkIntervalId = null;
let refreshIntervalId = null;

function inQuietHours(d = new Date()) {
    const h = d.getHours();
    // Window wraps past midnight, so it's an OR of the two ends.
    return h >= QUIET_START || h < QUIET_END;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readJson(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key) || fallback);
    } catch {
        return JSON.parse(fallback);
    }
}

function getNotifiedSet() { return new Set(readJson(NOTIFIED_KEY, '[]')); }
function saveNotifiedSet(set) { localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set])); }
function getSnoozes() { return readJson(SNOOZE_KEY, '{}'); }
function saveSnoozes(s) { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)); }
function getOverdueSet() { return new Set(readJson(OVERDUE_KEY, '[]')); }
function saveOverdueSet(set) { localStorage.setItem(OVERDUE_KEY, JSON.stringify([...set])); }

function dict() {
    return translations[localStorage.getItem('appLang') || 'zh'];
}

function fill(template, values) {
    return Object.keys(values).reduce((s, k) => s.replace(`{${k}}`, values[k]), template);
}

function openTaskDrawerIfClosed() {
    const drawer = document.getElementById('taskDrawer');
    if (drawer && !drawer.classList.contains('open') && window.toggleTaskDrawer) {
        window.toggleTaskDrawer();
    }
}

// ---- Deadline tiers (heads-up + urgent, with snooze) ----------------------

function snoozeTier(taskId, tierId) {
    const key = `${taskId}:${tierId}`;
    const snoozes = getSnoozes();
    snoozes[key] = Date.now() + SNOOZE_MS;
    saveSnoozes(snoozes);
    const notified = getNotifiedSet();
    notified.delete(key);
    saveNotifiedSet(notified);
}

function fireTier(task, tier, notifiedSet) {
    const message = fill(dict()[tier.messageKey], { title: task.title });
    pulseBuddyAvatar();
    pulseBuddyWidget();

    const actions = tier.snoozable ? [{
        label: dict().reminderSnoozeBtn,
        variant: 'secondary',
        onClick: () => snoozeTier(task.id, tier.id),
    }] : [];
    showBuddyBubble(message, { actions });

    // OS notification is additive and stays quiet during quiet hours.
    if (tier.notifyOS && !inQuietHours()
        && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(task.title, { body: message, icon: getChatAvatarSrc() });
        notification.onclick = () => { window.focus(); openTaskDrawerIfClosed(); };
    }

    notifiedSet.add(`${task.id}:${tier.id}`);
}

function checkDeadlines() {
    if (localStorage.getItem(ENABLED_KEY) !== 'true') return;
    const notifiedSet = getNotifiedSet();
    const snoozes = getSnoozes();
    const now = Date.now();
    let notifiedChanged = false;
    let snoozeChanged = false;

    (state.lastLoadedTasks || []).forEach(task => {
        if (task.completed || !task.dueDate) return;
        const due = new Date(task.dueDate).getTime();
        if (Number.isNaN(due)) return;
        const minutesUntilDue = (due - now) / 60000;
        // Once a task is actually past due, the tiers stop — the compassionate
        // overdue check-in takes over so we never say "due in 30 min" about
        // something already late.
        if (minutesUntilDue < 0) return;

        TIERS.forEach(tier => {
            if (minutesUntilDue > tier.leadMinutes) return;
            const key = `${task.id}:${tier.id}`;
            const snoozeUntil = snoozes[key];
            if (snoozeUntil && now < snoozeUntil) return;   // still snoozing
            if (notifiedSet.has(key)) return;               // already fired
            fireTier(task, tier, notifiedSet);
            notifiedChanged = true;
            if (snoozeUntil) { delete snoozes[key]; snoozeChanged = true; }
        });
    });

    if (notifiedChanged) saveNotifiedSet(notifiedSet);
    if (snoozeChanged) saveSnoozes(snoozes);
}

// ---- Daily brief (fresh-start orientation, once per day) ------------------

function todaysIncompleteTasks() {
    const now = new Date();
    const out = [];
    (state.lastLoadedTasks || []).forEach(task => {
        if (task.completed || !task.localDueDate || task.localDueDate === 'No Deadline') return;
        const d = new Date(task.localDueDate.replace(' ', 'T'));
        if (Number.isNaN(d.valueOf())) return;
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
            out.push({ task, d });
        }
    });
    return out.sort((a, b) => a.d - b.d);
}

function maybeDailyBrief() {
    if (localStorage.getItem(ENABLED_KEY) !== 'true' || !getUserId()) return;
    if (inQuietHours()) return;                                  // greet in the morning, not at 3am
    if (localStorage.getItem(BRIEF_KEY) === todayStr()) return; // once per day

    const d = dict();
    const hour = new Date().getHours();
    const salutation = hour < 12 ? d.greetingMorning : hour < 18 ? d.greetingAfternoon : d.greetingEvening;
    const todays = todaysIncompleteTasks();

    let msg;
    if (todays.length) {
        const first = todays[0];
        msg = fill(d.briefToday, {
            salutation,
            count: todays.length,
            title: first.task.title,
            time: first.task.localDueDate.substring(11, 16),
        });
    } else {
        msg = fill(d.briefNoneToday, { salutation });
    }

    pulseBuddyWidget();
    showBuddyBubble(msg, { duration: 9000 });
    localStorage.setItem(BRIEF_KEY, todayStr());
}

// ---- Compassionate overdue check-in (kind reset, once per lapse) ----------

function fireOverdue(task, overdueSet) {
    pulseBuddyWidget();
    showBuddyBubble(fill(dict().overdueCheckin, { title: task.title }), {
        actions: [{
            label: dict().overdueRescheduleBtn,
            onClick: () => openEditModal(task.id, task.title, task.description || '', task.dueDate || ''),
        }],
    });
    overdueSet.add(String(task.id));
}

function checkOverdue() {
    if (localStorage.getItem(ENABLED_KEY) !== 'true' || !getUserId()) return;
    if (inQuietHours()) return;

    const now = Date.now();
    const overdueSet = getOverdueSet();
    let changed = false;
    const candidates = [];

    (state.lastLoadedTasks || []).forEach(task => {
        if (!task.dueDate) return;
        const due = new Date(task.dueDate).getTime();
        if (Number.isNaN(due)) return;
        const key = String(task.id);
        // Cleared once it's done or rescheduled into the future, so a task that
        // lapses again later can gently check in one more time.
        if (task.completed || due >= now) {
            if (overdueSet.has(key)) { overdueSet.delete(key); changed = true; }
            return;
        }
        if (!overdueSet.has(key)) candidates.push({ task, due });
    });

    if (candidates.length) {
        // At most one per pass (no flood); the most recently lapsed is the most
        // actionable and least discouraging to surface first.
        candidates.sort((a, b) => b.due - a.due);
        fireOverdue(candidates[0].task, overdueSet);
        changed = true;
    }

    if (changed) saveOverdueSet(overdueSet);
}

// ---- Wiring ---------------------------------------------------------------

// Runs whenever task/buddy data refreshes (dispatched by loadTasks etc.) — the
// brief and overdue check-in are data-driven, not time-driven, so they always
// see current tasks.
function onDataRefresh() {
    maybeDailyBrief();
    checkOverdue();
}

function startReminderLoop() {
    if (checkIntervalId) return;
    checkDeadlines();
    checkIntervalId = setInterval(checkDeadlines, CHECK_INTERVAL_MS);
    refreshIntervalId = setInterval(() => {
        const tzSelect = document.getElementById('timezoneSelect');
        if (tzSelect && tzSelect.value) loadTasks(tzSelect.value);
    }, REFRESH_TASKS_INTERVAL_MS);
}

function stopReminderLoop() {
    clearInterval(checkIntervalId);
    clearInterval(refreshIntervalId);
    checkIntervalId = null;
    refreshIntervalId = null;
}

function updateStatusText() {
    const statusEl = document.getElementById('remindersStatus');
    const btn = document.getElementById('remindersToggleBtn');
    const d = dict();
    const enabled = localStorage.getItem(ENABLED_KEY) === 'true';

    if (btn) btn.textContent = enabled ? d.remindersDisableBtn : d.remindersEnableBtn;
    if (!statusEl) return;

    if (!enabled) {
        statusEl.textContent = d.remindersStatusOff;
    } else if (typeof Notification === 'undefined') {
        statusEl.textContent = d.remindersStatusUnsupported;
    } else if (Notification.permission === 'granted') {
        statusEl.textContent = d.remindersStatusGranted;
    } else {
        statusEl.textContent = d.remindersStatusEnabledNoOS;
    }
}

export function toggleReminders() {
    const isEnabled = localStorage.getItem(ENABLED_KEY) === 'true';
    if (isEnabled) {
        localStorage.setItem(ENABLED_KEY, 'false');
        stopReminderLoop();
        updateStatusText();
        return;
    }

    localStorage.setItem(ENABLED_KEY, 'true');
    startReminderLoop();
    onDataRefresh();  // greet + gentle overdue nudge right away, not next cycle
    if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
        Notification.requestPermission().then(updateStatusText);
    }
    updateStatusText();
}

export function initReminders() {
    document.addEventListener('nexus:today-refresh', onDataRefresh);
    updateStatusText();
    if (localStorage.getItem(ENABLED_KEY) === 'true') {
        startReminderLoop();
    }
}
