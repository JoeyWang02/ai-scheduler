import { state } from './state.js';
import { closeLifePanelModal, getActiveAnalysisPeriod, loadLifestyleAnalysis, openLifePanelModal, switchAnalysisPeriod } from './analytics.js';
import { closeAuthModal, consumeOAuthRedirect, getUserId, openAuthModal, renderAuthState, requestPasswordCode, setAuthMode, signOut, startExternalAuth, submitCurrentAuth } from './auth.js';
import { closeBuddyStatusModal, openBuddyStatusModal, refreshBuddyState, syncAllBuddyAvatars } from './buddy.js';
import { initBuddyWidget, isBuddyWidgetPinned, resetBuddyWidgetPosition, unpinBuddyWidget, updateChatWindowPosition } from './buddyWidget.js';
import { appendMessage, checkAiStatus, sendMessage, syncSelectedTasks } from './chat.js';
import { applyLanguage, toggleLanguage, translations } from './i18n.js';
import { initReminders, toggleReminders } from './reminders.js';
import { closeImportModal, closeModal, confirmUnifiedImport, courseApiUrl, courseToCalendarEvent, initCalendar, loadTasks, loadTimezones, onTimezoneChange, openEditModal, openImportModal, previewUnifiedImport, saveManualTask, taskApiUrl, taskToCalendarEvent, updateTaskColor } from './scheduler.js';
import { applyServerPreferences, closeSettingsModal, openSettingsModal, saveSettings } from './settings.js';
import { previewTheme, setTheme, toggleNightMode } from './theme.js';
import { initTodayBand } from './todayBand.js';

document.addEventListener('DOMContentLoaded', function () {
            consumeOAuthRedirect();
            const savedTheme = localStorage.getItem('appTheme') || 'stardew';
            setTheme(savedTheme);
            applyServerPreferences(state.currentUser ? state.currentUser.preferences : null);
            if (getUserId()) refreshBuddyState();
            checkAiStatus();

            let initialTz = (state.currentUser && state.currentUser.timezone) || document.getElementById('timezoneSelect').value;
            if (!initialTz) {
                initialTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
            }
            document.getElementById('timezoneSelect').value = initialTz;
            setAuthMode('signin');
            renderAuthState();
            loadTimezones(initialTz);
            initCalendar(initialTz);
            initTodayBand();
            applyLanguage();
            loadTasks(initialTz);
            loadLifestyleAnalysis('day', initialTz);
            initBuddyWidget();
            initReminders();

            // The task panel now pushes/shrinks the calendar via a real
            // width transition (not transform), so FullCalendar's own
            // internal grid needs an explicit updateSize() — a CSS width
            // transition doesn't fire the browser's resize event, which is
            // the only thing FullCalendar listens to on its own.
            document.getElementById('taskDrawer').addEventListener('transitionend', (event) => {
                if (event.propertyName === 'width' && state.calendar) state.calendar.updateSize();
            });

            window.onclick = function (event) {
                const modal = document.getElementById('taskModal');
                if (event.target == modal) closeModal();
                const authModal = document.getElementById('authModal');
                if (event.target == authModal) closeAuthModal();
                const importModal = document.getElementById('importModal');
                if (event.target == importModal) closeImportModal();
                const settingsModal = document.getElementById('settingsModal');
                if (event.target == settingsModal) closeSettingsModal();
                const lifePanelModal = document.getElementById('lifePanelModal');
                if (event.target == lifePanelModal) closeLifePanelModal();
                const buddyStatusModal = document.getElementById('buddyStatusModal');
                if (event.target == buddyStatusModal) closeBuddyStatusModal();

                const taskDrawer = document.getElementById('taskDrawer');
                const taskToggleBtn = document.getElementById('taskToggleBtn');
                if (taskDrawer.classList.contains('open') && !taskDrawer.contains(event.target) && !taskToggleBtn.contains(event.target)) {
                    closeTaskDrawer();
                }
                const chatDrawer = document.getElementById('chatDrawer');
                const chatToggleBtn = document.getElementById('chatToggleBtn');
                if (chatDrawer.classList.contains('open') && !chatDrawer.contains(event.target) && !chatToggleBtn.contains(event.target)) {
                    closeChatDrawer();
                }

                const buddyWidget = document.getElementById('buddyWidget');
                if (isBuddyWidgetPinned() && buddyWidget && !buddyWidget.contains(event.target)) {
                    unpinBuddyWidget();
                }
            };

            document.addEventListener('keydown', function (event) {
                if (event.key !== 'Escape') return;
                const closers = {
                    authModal: closeAuthModal,
                    settingsModal: closeSettingsModal,
                    taskModal: closeModal,
                    importModal: closeImportModal,
                    lifePanelModal: closeLifePanelModal,
                    buddyStatusModal: closeBuddyStatusModal,
                    editTaskModal: () => { document.getElementById('editTaskModal').style.display = 'none'; }
                };
                Object.entries(closers).forEach(([id, closeFn]) => {
                    const modal = document.getElementById(id);
                    if (modal && getComputedStyle(modal).display !== 'none') closeFn();
                });
                if (document.getElementById('taskDrawer').classList.contains('open')) closeTaskDrawer();
                if (document.getElementById('chatDrawer').classList.contains('open')) closeChatDrawer();
            });

            syncAllBuddyAvatars();
            const currentLang = localStorage.getItem('appLang') || 'zh';
            appendMessage('ai', translations[currentLang].aiWelcome);
        });

/* Drawers are overlays, not resizable panes — opening one never resizes or
   reflows the calendar (see Design Principles: "AI assists, it doesn't
   dominate" / "calendar is the permanent surface"). Focus moves into the
   drawer on open and returns to the rail button that opened it on close,
   matching standard dialog behavior. */

export function openTaskDrawer() {
            const drawer = document.getElementById('taskDrawer');
            drawer.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
            document.getElementById('taskToggleBtn').setAttribute('aria-pressed', 'true');
            const firstFocusable = drawer.querySelector('.add-task-btn');
            if (firstFocusable) firstFocusable.focus();
        }

export function closeTaskDrawer() {
            const drawer = document.getElementById('taskDrawer');
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
            const btn = document.getElementById('taskToggleBtn');
            btn.setAttribute('aria-pressed', 'false');
            btn.focus();
        }

export function toggleTaskDrawer() {
            const drawer = document.getElementById('taskDrawer');
            if (drawer.classList.contains('open')) closeTaskDrawer(); else openTaskDrawer();
        }

export function openChatDrawer() {
            const drawer = document.getElementById('chatDrawer');
            drawer.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
            document.getElementById('chatToggleBtn').setAttribute('aria-pressed', 'true');
            updateChatWindowPosition();
            const input = document.getElementById('userInput');
            if (input) input.focus();
        }

export function closeChatDrawer() {
            const drawer = document.getElementById('chatDrawer');
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
            const btn = document.getElementById('chatToggleBtn');
            btn.setAttribute('aria-pressed', 'false');
            btn.focus();
        }

export function toggleChatDrawer() {
            const drawer = document.getElementById('chatDrawer');
            if (drawer.classList.contains('open')) closeChatDrawer(); else openChatDrawer();
        }

export function refreshUserScopedViews() {
            const timezone = document.getElementById('timezoneSelect').value;
            if (state.calendar) {
                state.calendar.removeAllEventSources();
                state.calendar.addEventSource({ url: taskApiUrl(timezone), eventDataTransform: taskToCalendarEvent });
                state.calendar.addEventSource({ url: courseApiUrl(timezone), eventDataTransform: courseToCalendarEvent });
            }
            loadTasks(timezone);
            loadLifestyleAnalysis(getActiveAnalysisPeriod());
        }

Object.assign(window, {
    closeAuthModal,
    closeBuddyStatusModal,
    closeChatDrawer,
    closeImportModal,
    closeLifePanelModal,
    closeModal,
    closeSettingsModal,
    closeTaskDrawer,
    confirmUnifiedImport,
    onTimezoneChange,
    openAuthModal,
    openBuddyStatusModal,
    openEditModal,
    openImportModal,
    openLifePanelModal,
    openSettingsModal,
    previewTheme,
    previewUnifiedImport,
    requestPasswordCode,
    resetBuddyWidgetPosition,
    saveManualTask,
    saveSettings,
    sendMessage,
    setAuthMode,
    signOut,
    startExternalAuth,
    submitCurrentAuth,
    switchAnalysisPeriod,
    syncSelectedTasks,
    toggleChatDrawer,
    toggleNightMode,
    toggleLanguage,
    toggleReminders,
    toggleTaskDrawer,
    updateTaskColor
});
