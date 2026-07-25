import { API_BASE } from './config.js';
import { state } from './state.js';
import { translations } from './i18n.js';
import { escapeHtml, getUtcOffsetLabel, linkify, showToast } from './utils.js';
import { celebrateBuddyProgress, renderBuddyMoodBadge, renderBuddyStatus } from './buddy.js';
import { getActiveAnalysisPeriod, loadLifestyleAnalysis, translateDynamicText } from './analytics.js';
import { addAuthParams, getAuthToken, getUserId, requireUser } from './auth.js';
import { refreshUserScopedViews } from './app.js';
import { toggleTranslate, triggerAutoAiPlanner } from './chat.js';

export function taskApiUrl(timezone) {
            const params = new URLSearchParams({ timezone });
            return `${API_BASE}/api/tasks?${addAuthParams(params).toString()}`;
        }

export function courseApiUrl(timezone) {
            const params = new URLSearchParams({ timezone });
            return getUserId() ? `${API_BASE}/api/courses?${addAuthParams(params).toString()}` : `${API_BASE}/api/courses?userId=-1&authToken=guest`;
        }

export async function loadTimezones(defaultTimezone) {
            try {
                const zones = Intl.supportedValuesOf('timeZone')
                    .filter(zone => zone.includes('/') && !zone.startsWith('Etc/') && !zone.startsWith('SystemV/'));

                const groups = {};
                zones.forEach(zone => {
                    const region = zone.split('/')[0];
                    if (!groups[region]) groups[region] = [];
                    groups[region].push(zone);
                });

                const select = document.getElementById('timezoneSelect');
                select.innerHTML = '';
                Object.keys(groups).sort().forEach(region => {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = region;
                    groups[region].sort().forEach(zone => {
                        const option = document.createElement('option');
                        option.value = zone;
                        option.innerText = `${zone.split('/').slice(1).join('/').replace(/_/g, ' ')} (${getUtcOffsetLabel(zone)})`;
                        optgroup.appendChild(option);
                    });
                    select.appendChild(optgroup);
                });

                const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
                select.value = zones.includes(defaultTimezone) ? defaultTimezone : fallback;
            } catch (e) {
                console.error("加载时区失败", e);
            }
        }

export function taskToCalendarEvent(task) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const transTitle = translateDynamicText(task.title, 'title', lang);
            const transDesc = translateDynamicText(task.description, 'desc', lang);

            let evColor = task.color || '#3b82f6';
            if ((task.title.includes('[AI]') || task.title.includes('[智能规划]')) && !task.color) evColor = '#8b5cf6';

            let startIso = task.localDueDate;
            let endIso = task.localDueDate;
            try {
                if (task.localDueDate) {
                    let parsed = new Date(task.localDueDate.replace(' ', 'T'));
                    if (!isNaN(parsed.valueOf())) {
                        startIso = parsed.toISOString();
                        endIso = new Date(parsed.getTime() + 2 * 60 * 60 * 1000).toISOString();
                    }
                }
            } catch (e) { }

            return {
                id: task.id,
                title: transTitle,
                start: startIso,
                end: endIso,
                extendedProps: {
                    taskId: task.id,
                    description: transDesc,
                    formattedDate: task.localDueDate,
                    rawStart: startIso, // 鎼哄甫绾噣鏃堕棿鐢ㄤ簬缂栬緫鍥炴樉
                    color: task.color
                },
                color: evColor
            };
        }

export function courseToCalendarEvent(event) {
            let startIso = event.start;
            let endIso = event.end;
            try {
                if (event.start) {
                    let parsedStart = new Date(event.start.replace(' ', 'T'));
                    if (!isNaN(parsedStart.valueOf())) startIso = parsedStart.toISOString();
                }
                if (event.end) {
                    let parsedEnd = new Date(event.end.replace(' ', 'T'));
                    if (!isNaN(parsedEnd.valueOf())) endIso = parsedEnd.toISOString();
                }
            } catch (e) { console.warn('课程时间解析失败', e); }

            return {
                id: 'course-' + event.id,
                title: event.title,
                start: startIso,
                end: endIso,
                extendedProps: {
                    courseId: event.id, // 涓撻棬鐨勮绋?ID 鏍囪
                    description: event.location || '课程地点/时间',
                    formattedDate: `${(event.start || '').replace('T', ' ')} - ${(event.end || '').includes('T') ? event.end.split('T')[1] : (event.end || '')}`
                },
                color: '#16b99a'
            };
        }

export function initCalendar(timezone) {
            const calendarEl = document.getElementById('calendar');
            state.calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'dayGridMonth',
                height: '100%',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
                },
                eventSources: [
                    { url: taskApiUrl(timezone), eventDataTransform: taskToCalendarEvent },
                    { url: courseApiUrl(timezone), eventDataTransform: courseToCalendarEvent }
                ],
                // ... 淇濇寔 eventDidMount 鐨?tippy 鎻愮ず璇嶄笉鍙?...
                eventDidMount: function (info) {
                    const desc = info.event.extendedProps.description || "暂无详情";
                    tippy(info.el, {
                        content: `<div style="font-family: Inter; padding: 4px;">
                                <strong style="font-size: 13px;">${escapeHtml(info.event.title)}</strong><br>
                                <div style="font-size:12px; margin-top: 4px; color:#94a3b8; max-height:60px; overflow:hidden;">${linkify(desc)}</div>
                              </div>`,
                        allowHTML: true, interactive: true, theme: 'dark', appendTo: () => document.body, placement: 'top',
                    });
                },
                eventClick: function (info) {
                    showModal(
                        info.event.title,
                        info.event.extendedProps.formattedDate,
                        info.event.extendedProps.description,
                        info.event.extendedProps.taskId,
                        // FullCalendar's EventApi has no `.color` getter — the
                        // `color` shorthand from taskToCalendarEvent is stored
                        // as backgroundColor, so reading `.color` here would
                        // always be undefined and the picker would fall back
                        // to the default blue on every reopen.
                        info.event.backgroundColor,
                        info.event.extendedProps.courseId
                    );
                }
            });
            state.calendar.render();
            setTimeout(() => { state.calendar.updateSize(); }, 100);
        }

export function showModal(title, date, desc, taskId, color, courseId = null, rawDate = null) {
            const lang = localStorage.getItem('appLang') || 'zh';
            state.currentOpenedTaskId = taskId;

            document.getElementById('modalTitle').innerText = title;
            document.getElementById('modalDate').innerText = (lang === 'zh' ? "时间: " : "Time: ") + date;
            document.getElementById('modalDescription').innerHTML = linkify(desc) || (lang === 'zh' ? "暂无详细描述。" : "No description.");
            document.getElementById('taskColorPicker').value = color || '#3b82f6';

            const deleteBtn = document.getElementById('deleteTaskBtn');
            const editBtn = document.getElementById('editTaskBtn');

            if (taskId) {
                deleteBtn.style.display = 'inline-block';
                editBtn.style.display = 'inline-block';
                deleteBtn.onclick = function () { deleteTask(taskId); };
                editBtn.onclick = function () { closeModal(); openEditModal(taskId, title, desc, rawDate); };
            } else if (courseId) {
                deleteBtn.style.display = 'inline-block';
                editBtn.style.display = 'none'; // 课程暂不支持前端修改
                deleteBtn.onclick = function () { deleteCourse(courseId); };
            } else {
                deleteBtn.style.display = 'none';
                editBtn.style.display = 'none';
            }
            document.getElementById('taskModal').style.display = 'block';
        }

export function openEditModal(taskId = null, title = '', desc = '', rawDate = '', endDate = '') {
            if (!requireUser()) return;
            document.getElementById('editTaskId').value = taskId || '';
            document.getElementById('editTaskName').value = title.replace('[AI] ', '').replace('[智能] ', '');
            document.getElementById('editTaskDesc').value = desc;
            
            // 鍥炴樉鏃讹紝涓㈠純甯︽椂鍖虹殑 'Z'锛屼繚鐣欑函鍑€鐨?'YYYY-MM-DDTHH:mm' 鏍煎紡璧嬪€肩粰 input
            document.getElementById('editTaskDate').value = rawDate ? rawDate.substring(0, 16) : '';
            // 濡傛灉鍚庣鏈夌粨鏉熸椂闂村垯鏄剧ず锛屾病鏈夌殑璇濋粯璁ゅ～璧峰鏃堕棿
            document.getElementById('editTaskEndDate').value = endDate ? endDate.substring(0, 16) : (rawDate ? rawDate.substring(0, 16) : '');
            
            document.getElementById('editTaskModal').style.display = 'block';
        }

export async function saveManualTask() {
            const taskId = document.getElementById('editTaskId').value;
            const title = document.getElementById('editTaskName').value.trim();
            const startStr = document.getElementById('editTaskDate').value;
            const endStr = document.getElementById('editTaskEndDate').value;
            const desc = document.getElementById('editTaskDesc').value.trim();

            const lang = localStorage.getItem('appLang') || 'zh';
            if (!title || !startStr) return alert(translations[lang].alertEnterTaskInfo);
            if (taskId && !confirm(translations[lang].confirmEditTask)) return;
            
            // 缁勮绾噣鏃堕棿瀛楃涓诧紝涓嶈鍦ㄨ繖閲屽仛 new Date()
            const taskData = { 
                title: title, 
                description: desc, 
                dueDate: startStr + ":00", // 琛ラ綈绉掓暟锛岀鍚?LocalDateTime 鏍煎紡
                // 鏆傛椂鍒╃敤 description 鐨勬墿灞曟€у瓨涓€涓嬬粨鏉熸椂闂达紙绋嶅悗鍘诲悗绔敼琛ㄧ粨鏋勬渶褰诲簳锛岃繖閲屾殏鏃跺厛瀛樿捣濮嬶級
            };
            
            const currentTz = document.getElementById('timezoneSelect').value;
            
            let url = `${API_BASE}/api/tasks?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(currentTz)}`;
            let method = 'POST';
            if (taskId) {
                url = `${API_BASE}/api/tasks/${taskId}?authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(currentTz)}`;
                method = 'PUT';
            }
            
            try {
                const res = await fetch(url, {
                    method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(taskData)
                });
                if (res.ok) {
                    document.getElementById('editTaskModal').style.display = 'none';
                    state.calendar.refetchEvents();
                    loadTasks(currentTz);
                    loadLifestyleAnalysis(getActiveAnalysisPeriod(), currentTz, true);
                    showToast(translations[lang].taskSavedToast, 'success');
                } else showToast(translations[lang].alertSaveFailed, 'error');
            } catch (e) { showToast(translations[lang].alertNetworkError, 'error'); }
        }

export async function deleteCourse(courseId) {
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!confirm(translations[lang].confirmDeleteCourse)) return;

            try {
                const response = await fetch(`${API_BASE}/api/courses/${courseId}?authToken=${encodeURIComponent(getAuthToken())}`, { method: 'DELETE' });
                if (response.ok) {
                    closeModal();
                    state.calendar.refetchEvents();
                } else {
                    alert(translations[lang].alertDeleteFail);
                }
            } catch (e) {
                console.error("删除课程出错", e);
            }
        }

export async function updateTaskColor() {
            if (!state.currentOpenedTaskId) return;
            const newColor = document.getElementById('taskColorPicker').value;
            const lang = localStorage.getItem('appLang') || 'zh';

            try {
                await fetch(`${API_BASE}/api/tasks/${state.currentOpenedTaskId}/color?authToken=${encodeURIComponent(getAuthToken())}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: newColor })
                });

                const currentTz = document.getElementById('timezoneSelect').value;
                state.calendar.refetchEvents();
                loadTasks(currentTz);
                closeModal();
                showToast(translations[lang].colorSavedToast, 'success');
            } catch (e) {
                showToast(translations[lang].alertColorFail, 'error');
            }
        }

export async function deleteTask(taskId) {
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!confirm(translations[lang].confirmDeleteTask)) return;

            try {
                const response = await fetch(`${API_BASE}/api/tasks/${taskId}?authToken=${encodeURIComponent(getAuthToken())}`, { method: 'DELETE' });
                if (response.ok) {
                    closeModal();
                    state.calendar.refetchEvents();
                    const currentTz = document.getElementById('timezoneSelect').value;
                    loadTasks(currentTz);
                    loadLifestyleAnalysis(getActiveAnalysisPeriod(), currentTz);
                } else {
                    alert(translations[lang].alertDeleteFail);
                }
            } catch (e) {
                console.error("鍒犻櫎鍑洪敊", e);
            }
        }

export function closeModal() {
            document.getElementById('taskModal').style.display = 'none';
        }

export async function onTimezoneChange() {
            const selectedTz = document.getElementById('timezoneSelect').value;
            refreshUserScopedViews();
            loadTasks(selectedTz);
            loadLifestyleAnalysis(getActiveAnalysisPeriod(), selectedTz);

            const lang = localStorage.getItem('appLang') || 'zh';
            if (getUserId()) {
                try {
                    const response = await fetch(`${API_BASE}/api/auth/timezone?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ timezone: selectedTz })
                    });
                    if (!response.ok) {
                        console.error('Timezone sync failed', response.status, await response.text());
                        showToast(lang === 'zh' ? '时区已应用，但同步到账号失败' : 'Timezone applied, but syncing to your account failed', 'error');
                        return;
                    }
                    state.currentUser.timezone = selectedTz;
                    localStorage.setItem('nexusUser', JSON.stringify(state.currentUser));
                    showToast(lang === 'zh' ? '时区已同步到账号' : 'Timezone synced to your account', 'success');
                } catch (e) {
                    console.error('Failed to sync timezone to server', e);
                    showToast(lang === 'zh' ? '时区已应用，但同步到账号失败' : 'Timezone applied, but syncing to your account failed', 'error');
                }
            } else {
                showToast(lang === 'zh' ? '时区已应用到本机（登录后可跨设备同步）' : 'Timezone applied locally (sign in to sync across devices)', 'info');
            }
        }

export async function toggleTaskComplete(taskId, completed, itemEl) {
            itemEl.classList.toggle('completed', completed);
            try {
                const response = await fetch(`${API_BASE}/api/tasks/${taskId}/complete?authToken=${encodeURIComponent(getAuthToken())}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ completed })
                });
                if (!response.ok) return;
                const result = await response.json();
                if (result.buddyState) {
                    state.lastBuddyState = result.buddyState;
                    renderBuddyStatus();
                    renderBuddyMoodBadge();
                    celebrateBuddyProgress(result.buddyState);
                }
                // Keep the cached task in sync so the Today band (and any other
                // view reading state.lastLoadedTasks) reflects the new completed
                // state without a full reload, then let them re-render.
                const cached = (state.lastLoadedTasks || []).find(t => String(t.id) === String(taskId));
                if (cached) cached.completed = completed;
                document.dispatchEvent(new Event('nexus:today-refresh'));
            } catch (e) {
                console.error('Failed to update task completion', e);
            }
        }

export async function loadTasks(timezone) {
            const taskListEl = document.getElementById('taskList');
            const lang = localStorage.getItem('appLang') || 'zh';
            try {
                const response = await fetch(taskApiUrl(timezone));
                const tasks = await response.json();
                state.lastLoadedTasks = tasks;
                document.dispatchEvent(new Event('nexus:today-refresh'));

                if (!tasks.length) {
                    taskListEl.innerHTML = `<div class="empty-state-box"><div class="empty-state-icon">🎯</div><div style="font-size: 13px; font-weight: 500;">${escapeHtml(translations[lang].noTasks)}</div></div>`;
                    return;
                }

                taskListEl.innerHTML = '';
                tasks.forEach(t => {
                    const transTitle = translateDynamicText(t.title, 'title', lang);
                    const transDesc = translateDynamicText(t.description, 'desc', lang);
                    const item = document.createElement('div');
                    item.className = 'task-item' + (t.completed ? ' completed' : '');
                    item.addEventListener('click', () => showModal(transTitle, t.localDueDate, transDesc, t.id, t.color || '', null, t.dueDate || t.localDueDate));

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'task-complete-checkbox';
                    checkbox.checked = !!t.completed;
                    checkbox.onclick = (e) => e.stopPropagation();
                    checkbox.onchange = () => toggleTaskComplete(t.id, checkbox.checked, item);

                    const body = document.createElement('div');
                    body.className = 'task-item-body';
                    const titleEl = document.createElement('strong');
                    titleEl.innerText = transTitle;
                    const dateEl = document.createElement('div');
                    dateEl.className = 'date';
                    dateEl.innerText = `Due: ${t.localDueDate}`;
                    body.appendChild(titleEl);
                    body.appendChild(dateEl);

                    const translateBtn = document.createElement('button');
                    translateBtn.type = 'button';
                    translateBtn.className = 'translate-btn';
                    translateBtn.title = translations[lang].translateTooltip;
                    translateBtn.innerText = '🌐';
                    translateBtn.onclick = (e) => {
                        e.stopPropagation();
                        toggleTranslate(translateBtn, titleEl, transTitle, 'plain');
                    };

                    item.appendChild(checkbox);
                    item.appendChild(body);
                    item.appendChild(translateBtn);
                    taskListEl.appendChild(item);
                });
            } catch (e) { console.error("Failed to load task list", e); }
        }

export function openImportModal() {
            if (!requireUser()) return;
            state.currentImportPreview = null;
            document.getElementById('importSummary').innerText = '';
            document.getElementById('importPreviewList').innerHTML = '';
            document.getElementById('confirmImportBtn').style.display = 'none';
            document.getElementById('importModal').style.display = 'block';
        }

export function closeImportModal() {
            document.getElementById('importModal').style.display = 'none';
        }

export async function previewUnifiedImport() {
            if (!requireUser()) return;
            const lang = localStorage.getItem('appLang') || 'zh';
            const fileInput = document.getElementById('unifiedImportFile');
            const file = fileInput.files[0];
            if (!file) {
                alert(translations[lang].alertSelectFile);
                return;
            }
            const formData = new FormData();
            formData.append('file', file);
            const timezone = document.getElementById('timezoneSelect').value;
            const summaryEl = document.getElementById('importSummary');
            summaryEl.innerText = translations[lang].syncing;

            try {
                const response = await fetch(`${API_BASE}/api/import/preview?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(timezone)}`, {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message || translations[lang].checkInput);
                }
                state.currentImportPreview = result;
                renderImportPreview(result);
            } catch (error) {
                state.currentImportPreview = null;
                document.getElementById('confirmImportBtn').style.display = 'none';
                summaryEl.innerText = '';
                alert(translations[lang].importPreviewFail + error.message);
            }
        }

export function renderImportPreview(preview) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const list = document.getElementById('importPreviewList');
            const summary = document.getElementById('importSummary');
            list.innerHTML = '';
            summary.innerText = preview.summary || '';
            if (!preview.items || !preview.items.length) {
                list.innerHTML = `<div class="empty-state-box"><div class="empty-state-icon">📭</div><div>${escapeHtml(translations[lang].importNoItems)}</div></div>`;
                document.getElementById('confirmImportBtn').style.display = 'none';
                return;
            }
            preview.items.forEach(item => {
                const row = document.createElement('label');
                row.className = 'import-preview-item';
                const dateText = item.dueDate ? `Due: ${item.dueDate}` : item.start ? `Time: ${item.start} - ${item.end}` : '';
                row.innerHTML = `
                    <input type="checkbox" class="import-item-check" value="${escapeHtml(item.id)}" checked>
                    <div>
                        <div class="import-preview-title">${escapeHtml(item.title || 'Untitled')}</div>
                        <div class="import-preview-meta">
                            ${escapeHtml(item.kind || '')} · ${escapeHtml(item.source || '')} · confidence ${Math.round((item.confidence || 0) * 100)}%<br>
                            ${escapeHtml(dateText)}<br>
                            ${escapeHtml(item.notes || '')}
                        </div>
                    </div>`;
                list.appendChild(row);
            });
            document.getElementById('confirmImportBtn').style.display = 'block';
        }

export async function confirmUnifiedImport() {
            if (!requireUser() || !state.currentImportPreview) return;
            const lang = localStorage.getItem('appLang') || 'zh';
            const itemIds = Array.from(document.querySelectorAll('.import-item-check:checked')).map(input => input.value);
            try {
                const response = await fetch(`${API_BASE}/api/import/confirm?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ importId: state.currentImportPreview.importId, itemIds })
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message || translations[lang].checkInput);
                }
                alert(`${translations[lang].importDone}: ${result.tasks || 0} tasks, ${result.courses || 0} courses`);
                closeImportModal();
                refreshUserScopedViews();
            } catch (error) {
                alert(translations[lang].importConfirmFail + error.message);
            }
        }

export async function uploadFile(type) {
            if (!requireUser()) return;
            const fileInput = document.getElementById(type + 'File');
            const file = fileInput.files[0];
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!file) { alert(translations[lang].alertSelectFile); return; }

            const formData = new FormData();
            formData.append("file", file);

            const btn = event.target;
            const originalText = btn.innerText;
            btn.innerText = translations[lang].syncing;
            btn.disabled = true;

            try {
                const response = await fetch(`${API_BASE}/api/tasks/upload/${type}?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`, { method: 'POST', body: formData });
                const result = await response.text();

                if (response.ok) {
                    const currentTz = document.getElementById('timezoneSelect').value;
                    state.calendar.refetchEvents();
                    loadTasks(currentTz);
                    loadLifestyleAnalysis(getActiveAnalysisPeriod());
                    triggerAutoAiPlanner(type);
                } else {
                    alert(translations[lang].syncFail + result);
                }
            } catch (e) {
                alert(translations[lang].uploadFail);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
                fileInput.value = '';
            }
        }

export async function uploadIcsFile() {
            if (!requireUser()) return;
            const fileInput = document.getElementById('icsFile');
            const file = fileInput.files[0];
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!file) { alert(translations[lang].alertSelectIcs); return; }
            const timezone = document.getElementById('timezoneSelect').value;
            const formData = new FormData();
            formData.append("file", file);
            try {
                const response = await fetch(`${API_BASE}/api/courses/upload/ics?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(timezone)}`, {
                    method: 'POST',
                    body: formData
                });
                const result = await response.text();
                if (!response.ok) {
                    alert(result);
                    return;
                }
                alert(result);
                state.calendar.refetchEvents();
            } catch (e) {
                alert(translations[lang].icsUploadFail);
            } finally {
                fileInput.value = '';
            }
        }
