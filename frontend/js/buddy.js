import { API_BASE } from './config.js';
import { state } from './state.js';
import { translations } from './i18n.js';
import { escapeHtml, showToast } from './utils.js';
import { getAuthToken, getUserId } from './auth.js';

export const STUDY_BUDDIES = [
            { id: 'junimo', name: 'Junimo' },
            { id: 'chicken', name: '鸡' },
            { id: 'duck', name: '鸭' },
            { id: 'rabbit', name: '兔子' },
            { id: 'slime', name: '史莱姆' },
            { id: 'farmer-a', name: '农场少年' },
            { id: 'farmer-b', name: '农场少女' },
        ];

export function getChatAvatarSrc() {
            const id = localStorage.getItem('studyBuddy') || 'junimo';
            return `/images/${id}-avatar.svg`;
        }

export function renderAvatarPicker() {
            const picker = document.getElementById('avatarPicker');
            if (!picker) return;
            picker.innerHTML = '';
            STUDY_BUDDIES.forEach(buddy => {
                const option = document.createElement('div');
                option.className = 'avatar-option' + (buddy.id === state.pendingBuddy ? ' selected' : '');
                option.onclick = () => {
                    state.pendingBuddy = buddy.id;
                    renderAvatarPicker();
                };
                const img = document.createElement('img');
                img.src = `/images/${buddy.id}-avatar.svg`;
                img.alt = buddy.name;
                const label = document.createElement('span');
                label.innerText = buddy.name;
                option.appendChild(img);
                option.appendChild(label);
                picker.appendChild(option);
            });
        }

export const BUDDY_STAGE_EMOJI = { hatchling: '🥚', growing: '🐣', mature: '🐥' };

export const BUDDY_MOOD_EMOJI = { calm: '😌', happy: '😊', excited: '🤩' };

export async function refreshBuddyState() {
            if (!getUserId()) {
                state.lastBuddyState = null;
                renderBuddyStatus();
                renderBuddyMoodBadge();
                document.dispatchEvent(new Event('nexus:today-refresh'));
                return;
            }
            try {
                const response = await fetch(`${API_BASE}/api/buddy/state?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`);
                if (!response.ok) {
                    console.error('Failed to load buddy state', response.status);
                    return;
                }
                state.lastBuddyState = await response.json();
                renderBuddyStatus();
                renderBuddyMoodBadge();
                document.dispatchEvent(new Event('nexus:today-refresh'));
            } catch (e) {
                console.error('Failed to load buddy state', e);
            }
        }

function buildBuddyStatCardHtml() {
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];

            if (!state.lastBuddyState) {
                return `<div class="buddy-status-guest">${escapeHtml(dict.buddyStatusGuestHint)}</div>`;
            }

            const s = state.lastBuddyState;
            const stageEmoji = BUDDY_STAGE_EMOJI[s.stage] || '🥚';
            const moodEmoji = BUDDY_MOOD_EMOJI[s.mood] || '😌';
            const stageLabelKey = 'buddyStage' + s.stage.charAt(0).toUpperCase() + s.stage.slice(1);
            const moodLabelKey = 'buddyMood' + s.mood.charAt(0).toUpperCase() + s.mood.slice(1);
            const stageLabel = dict[stageLabelKey] || s.stage;
            const moodLabel = dict[moodLabelKey] || s.mood;
            const fillPct = s.xpPerLevel ? Math.min(100, Math.round((s.xpIntoLevel / s.xpPerLevel) * 100)) : 0;
            const substage = s.xpToNextStage == null
                ? dict.buddyMaxStage
                : `${s.xpToNextStage} XP → ${dict[('buddyStage' + (s.stage === 'hatchling' ? 'Growing' : 'Mature'))] || ''}`;
            const buddyId = localStorage.getItem('studyBuddy') || 'junimo';
            const buddyName = (STUDY_BUDDIES.find(b => b.id === buddyId) || STUDY_BUDDIES[0]).name;
            // Pips are a chunkier, game-HUD-style restatement of the same level
            // progress the XP bar already shows (5 segments, 20% each) — not a
            // separate data point, just a second visual register for it.
            const litPips = Math.max(0, Math.min(5, Math.round(fillPct / 20)));
            const pipsHtml = Array.from({ length: 5 }, (_, i) =>
                `<span class="buddy-card-pip${i < litPips ? ' on' : ''}"></span>`).join('');

            return `
                <div class="buddy-card-row">
                    <div class="buddy-card-avatar-box"><img src="${getChatAvatarSrc()}" alt=""></div>
                    <div class="buddy-card-identity">
                        <p class="buddy-card-name">${escapeHtml(buddyName)}</p>
                        <p class="buddy-card-stage">${stageEmoji} ${escapeHtml(stageLabel)}</p>
                    </div>
                    <div class="buddy-level-badge">Lv. ${s.level}</div>
                </div>
                <div class="buddy-card-xp-row">
                    <div class="buddy-card-xp-label"><span>${escapeHtml(dict.buddyXpToNextLevelLabel)}</span><span>${s.xpIntoLevel}/${s.xpPerLevel}</span></div>
                    <div class="xp-bar" title="${s.xpIntoLevel} / ${s.xpPerLevel} XP">
                        <div class="xp-bar-fill" style="width: ${fillPct}%;"></div>
                    </div>
                    <div class="buddy-card-pips">${pipsHtml}</div>
                </div>
                <div class="buddy-status-meta">
                    <span class="mood">${moodEmoji} ${escapeHtml(moodLabel)}</span>
                    <span class="buddy-completed-count">${dict.buddyTasksCompletedLabel}: ${s.totalTasksCompleted}</span>
                </div>
                <div class="buddy-status-substage">${escapeHtml(substage)}</div>
            `;
        }

export function renderBuddyStatus() {
            const html = buildBuddyStatCardHtml();
            const block = document.getElementById('buddyStatusBlock');
            if (block) block.innerHTML = html;
            const widgetCard = document.getElementById('buddyWidgetCard');
            if (widgetCard) widgetCard.innerHTML = html;
            const posterCard = document.getElementById('buddyPosterCard');
            if (posterCard) posterCard.innerHTML = html;
        }

export function openBuddyStatusModal() {
            if (getUserId()) refreshBuddyState(); else renderBuddyStatus();
            const dateEl = document.getElementById('buddyPosterDate');
            if (dateEl) {
                const lang = localStorage.getItem('appLang') || 'zh';
                dateEl.textContent = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            }
            document.getElementById('buddyStatusModal').style.display = 'block';
        }

export function closeBuddyStatusModal() {
            document.getElementById('buddyStatusModal').style.display = 'none';
        }

export function renderBuddyMoodBadge() {
            const badge = document.getElementById('buddyMoodBadge');
            if (!badge) return;
            if (!state.lastBuddyState) {
                badge.style.display = 'none';
                return;
            }
            badge.textContent = BUDDY_MOOD_EMOJI[state.lastBuddyState.mood] || '';
            badge.style.display = 'block';
        }

export function syncAllBuddyAvatars() {
            const src = getChatAvatarSrc();
            const headerAvatar = document.getElementById('chatHeaderAvatar');
            if (headerAvatar) headerAvatar.src = src;
            document.querySelectorAll('#messages .chat-avatar').forEach(img => {
                img.src = src;
            });
            const widgetAvatar = document.getElementById('buddyWidgetAvatar');
            if (widgetAvatar) widgetAvatar.src = src;
        }

export function getBuddyGreeting() {
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];
            const hour = new Date().getHours();
            const salutation = hour < 12 ? dict.greetingMorning : hour < 18 ? dict.greetingAfternoon : dict.greetingEvening;
            const mood = state.lastBuddyState ? state.lastBuddyState.mood : 'calm';
            const moodEmoji = BUDDY_MOOD_EMOJI[mood] || BUDDY_MOOD_EMOJI.calm;
            const lines = dict['buddyLines' + (mood.charAt(0).toUpperCase() + mood.slice(1))] || dict.buddyLinesCalm;
            const line = lines[Math.floor(Math.random() * lines.length)];
            return `${salutation} ${moodEmoji} ${line}`;
        }

export function pulseBuddyAvatar() {
            const el = document.getElementById('chatHeaderAvatar');
            if (!el) return;
            el.classList.remove('buddy-pulse');
            void el.offsetWidth;
            el.classList.add('buddy-pulse');
        }

export function celebrateBuddyProgress(buddyState) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];
            if (buddyState.justAdvancedStage) {
                showToast(dict.buddyStageUpToast, 'success');
                pulseBuddyAvatar();
            } else if (buddyState.justLeveledUp) {
                showToast(dict.buddyLevelUpToast.replace('{level}', buddyState.level), 'success');
                pulseBuddyAvatar();
            }
        }
