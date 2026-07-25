import { getBuddyGreeting, renderBuddyStatus } from './buddy.js';

const POSITION_KEY = 'buddyWidgetPos';
const DRAG_THRESHOLD = 4;
const EDGE_MARGIN = 16;
const IDLE_MS = 5 * 60 * 1000;

let widget, avatarEl, flyoutEl, greetingEl, bubbleEl, chatDrawerEl;
let chatPopper;
let pinned = false;
let isDragging = false;
let dragStartX = 0, dragStartY = 0, grabOffsetX = 0, grabOffsetY = 0;
let idleTimer = null;
let bubbleTimer = null;

function clamp(left, top, rect) {
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    return {
        left: Math.min(Math.max(left, 0), maxLeft),
        top: Math.min(Math.max(top, 0), maxTop),
    };
}

function applyPosition(left, top) {
    widget.style.left = `${left}px`;
    widget.style.top = `${top}px`;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
}

function snapToEdge(left, top, rect) {
    const distLeft = left;
    const distRight = window.innerWidth - (left + rect.width);
    const distTop = top;
    const distBottom = window.innerHeight - (top + rect.height);
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    if (minDist === distLeft) left = EDGE_MARGIN;
    else if (minDist === distRight) left = window.innerWidth - rect.width - EDGE_MARGIN;
    else if (minDist === distTop) top = EDGE_MARGIN;
    else top = window.innerHeight - rect.height - EDGE_MARGIN;

    return clamp(left, top, rect);
}

function restorePosition() {
    const saved = localStorage.getItem(POSITION_KEY);
    if (!saved) return;
    let pos;
    try {
        pos = JSON.parse(saved);
    } catch {
        return;
    }
    if (typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
    const rect = widget.getBoundingClientRect();
    const clamped = clamp(pos.left, pos.top, rect);
    applyPosition(clamped.left, clamped.top);
}

export function resetBuddyWidgetPosition() {
    localStorage.removeItem(POSITION_KEY);
    widget.style.left = '';
    widget.style.top = '';
    widget.style.right = '';
    widget.style.bottom = '';
}

function showFlyout() {
    flyoutEl.classList.add('open');
    flyoutEl.setAttribute('aria-hidden', 'false');
    widget.setAttribute('aria-expanded', 'true');
}

function hideFlyout() {
    flyoutEl.classList.remove('open');
    flyoutEl.setAttribute('aria-hidden', 'true');
    widget.setAttribute('aria-expanded', 'false');
}

function toggleFlyout() {
    pinned = !pinned;
    widget.classList.toggle('pinned', pinned);
    if (pinned) {
        renderBuddyStatus();
        greetingEl.textContent = getBuddyGreeting();
        showFlyout();
    } else {
        hideFlyout();
    }
}

export function isBuddyWidgetPinned() {
    return pinned;
}

export function unpinBuddyWidget() {
    if (!pinned) return;
    pinned = false;
    widget.classList.remove('pinned');
    hideFlyout();
}

export function pulseBuddyWidget() {
    if (!avatarEl) return;
    avatarEl.classList.remove('buddy-pulse');
    void avatarEl.offsetWidth;
    avatarEl.classList.add('buddy-pulse');
}

export function updateChatWindowPosition() {
    if (chatPopper) chatPopper.update();
}

export function showBuddyBubble(text, opts = {}) {
    if (!bubbleEl) return;
    // Back-compat: an older call passed a numeric duration as the 2nd arg.
    const options = typeof opts === 'number' ? { duration: opts } : (opts || {});
    const actions = options.actions || [];
    // Actionable bubbles linger longer so there's time to click.
    const duration = options.duration || (actions.length ? 15000 : 6000);

    bubbleEl.innerHTML = '';
    const textEl = document.createElement('div');
    textEl.className = 'buddy-bubble-text';
    textEl.textContent = text;
    bubbleEl.appendChild(textEl);

    if (actions.length) {
        const row = document.createElement('div');
        row.className = 'buddy-bubble-actions';
        actions.forEach(a => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'buddy-bubble-btn' + (a.variant ? ' ' + a.variant : '');
            btn.textContent = a.label;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                bubbleEl.classList.remove('open');
                clearTimeout(bubbleTimer);
                if (a.onClick) a.onClick();
            });
            row.appendChild(btn);
        });
        bubbleEl.appendChild(row);
    }

    bubbleEl.classList.add('open');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove('open'), duration);
}

function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(playIdleAnimation, IDLE_MS);
}

function playIdleAnimation() {
    if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
        const anims = ['buddy-idle-blink', 'buddy-idle-tilt'];
        const anim = anims[Math.floor(Math.random() * anims.length)];
        avatarEl.classList.add(anim);
        avatarEl.addEventListener('animationend', () => avatarEl.classList.remove(anim), { once: true });
    }
    resetIdleTimer();
}

function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // The flyout and chat window are now both DOM children of the widget
    // (so the chat window can be positioned relative to it and so clicks
    // inside it count as "inside the widget" for the outside-click-closes
    // handler). That means pointerdown/keydown events from typing in chat
    // or clicking a flyout button bubble up through this same element —
    // only a press that actually lands on the widget's own visual surface
    // (the avatar or its background) should start a drag/click sequence.
    if (e.target !== widget && e.target !== avatarEl) return;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = widget.getBoundingClientRect();
    grabOffsetX = e.clientX - rect.left;
    grabOffsetY = e.clientY - rect.top;
    isDragging = false;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        isDragging = true;
        widget.classList.add('dragging');
        unpinBuddyWidget();
    }
    if (isDragging) {
        const rect = widget.getBoundingClientRect();
        const target = clamp(e.clientX - grabOffsetX, e.clientY - grabOffsetY, rect);
        applyPosition(target.left, target.top);
        if (chatDrawerEl.classList.contains('open')) updateChatWindowPosition();
    }
}

function onPointerUp() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    if (isDragging) {
        widget.classList.remove('dragging');
        const rect = widget.getBoundingClientRect();
        const snapped = snapToEdge(rect.left, rect.top, rect);
        applyPosition(snapped.left, snapped.top);
        localStorage.setItem(POSITION_KEY, JSON.stringify(snapped));
    } else {
        // No real movement happened between pointerdown and pointerup —
        // this was a plain left-click, which toggles the flyout.
        toggleFlyout();
    }
    setTimeout(() => { isDragging = false; }, 0);
}

export function initBuddyWidget() {
    widget = document.getElementById('buddyWidget');
    if (!widget) return;
    avatarEl = document.getElementById('buddyWidgetAvatar');
    flyoutEl = document.getElementById('buddyWidgetFlyout');
    greetingEl = document.getElementById('buddyWidgetGreeting');
    bubbleEl = document.getElementById('buddyWidgetBubble');
    chatDrawerEl = document.getElementById('chatDrawer');

    chatPopper = window.Popper.createPopper(widget, chatDrawerEl, {
        placement: 'auto',
        strategy: 'fixed',
        modifiers: [
            { name: 'flip' },
            { name: 'preventOverflow', options: { padding: EDGE_MARGIN } },
            { name: 'offset', options: { offset: [0, 12] } },
            { name: 'computeStyles', options: { gpuAcceleration: false } },
        ],
    });

    restorePosition();
    window.addEventListener('resize', () => {
        if (localStorage.getItem(POSITION_KEY)) restorePosition();
        updateChatWindowPosition();
    });

    widget.addEventListener('pointerdown', onPointerDown);

    // Keyboard parity for the click-to-toggle interaction above — guarded
    // the same way onPointerDown is, so Space/Enter typed into the chat
    // input (a descendant of the widget) doesn't bubble up and toggle it.
    widget.addEventListener('keydown', (e) => {
        if (e.target !== widget) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleFlyout();
        }
    });

    flyoutEl.querySelectorAll('.buddy-widget-flyout-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'chat') window.toggleChatDrawer();
            else if (action === 'analysis') window.openLifePanelModal();
            else if (action === 'status') window.openBuddyStatusModal();
            unpinBuddyWidget();
        });
    });

    ['mousemove', 'click', 'keydown', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    resetIdleTimer();
}
