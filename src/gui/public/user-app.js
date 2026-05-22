import { initCustomCursor } from '/custom-cursor.js';
import { initNeuralBackground } from '/neural-background.js';
import { initNeuralBackgroundToggle } from '/neural-background-toggle.js';
import { initScrollIndicator, remeasureScrollIndicator } from '/scroll-indicator.js';
import { initUserMemory } from '/user-memory.js';

const $ = (id) => document.getElementById(id);

const USER_TABS = new Set(['overview', 'data', 'chat', 'telegram', 'access', 'calendar']);

let userTimezone = 'Asia/Rangoon';
let overviewClockTimer = null;

function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, credentials: opts.credentials ?? 'include' });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(msg, kind) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'statusbar' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
}

function showTab(name) {
  if (!USER_TABS.has(name)) name = 'overview';
  document.querySelectorAll('.nav-item[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${name}`);
  });
  if (name === 'overview') {
    loadOverview().catch((e) => setStatus(e.message, 'err'));
    startOverviewClock();
  } else {
    stopOverviewClock();
  }
  if (name === 'data') userMemory.loadUserMemoryTab().catch((e) => setStatus(e.message, 'err'));
  if (name === 'chat') loadChat().catch((e) => setStatus(e.message, 'err'));
  if (name === 'telegram') loadTelegram().catch((e) => setStatus(e.message, 'err'));
  if (name === 'access') loadAccess().catch((e) => setStatus(e.message, 'err'));
  if (name === 'calendar') loadCalendar().catch((e) => setStatus(e.message, 'err'));
  window.requestAnimationFrame(() => remeasureScrollIndicator());
}

function routeHash() {
  const h = (location.hash || '#overview').replace(/^#/, '');
  showTab(USER_TABS.has(h) ? h : 'overview');
}

function setStatusLed(el, state) {
  if (!el) return;
  el.classList.remove('live', 'warn', 'idle', 'unknown');
  if (state) el.classList.add(state);
}

function tickOverviewClock() {
  const line = $('overviewClockLine');
  const sub = $('overviewClockTz');
  if (!line) return;
  const d = new Date();
  try {
    line.textContent = d.toLocaleString('en-US', {
      timeZone: userTimezone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    if (sub) sub.textContent = userTimezone;
  } catch {
    line.textContent = d.toLocaleString();
    if (sub) sub.textContent = '';
  }
}

function startOverviewClock() {
  stopOverviewClock();
  tickOverviewClock();
  overviewClockTimer = setInterval(tickOverviewClock, 1000);
}

function stopOverviewClock() {
  if (overviewClockTimer) {
    clearInterval(overviewClockTimer);
    overviewClockTimer = null;
  }
}

function applyUserSidebarBotUi(st) {
  const circle = $('sidebarAiCircleWrap');
  const footerOrb = $('sidebarFooterOrnament');
  if (!st || typeof st !== 'object') {
    circle?.classList.remove('hidden');
    circle?.classList.remove('is-running');
    footerOrb?.classList.remove('running-glow');
    return;
  }
  const running = Boolean(st.running);
  if (circle) {
    circle.classList.remove('hidden');
    circle.classList.toggle('is-running', running);
  }
  footerOrb?.classList.toggle('running-glow', running);
}

async function refreshUserSidebarBotUi() {
  try {
    const st = await apiFetch('/api/user/bot/status').then((r) => r.json());
    applyUserSidebarBotUi(st);
  } catch {
    applyUserSidebarBotUi(null);
  }
}

async function loadOverview() {
  const o = await apiFetch('/api/user/overview').then((r) => r.json());
  if (o.error) throw new Error(o.error);
  userTimezone = o.timezone || 'Asia/Rangoon';
  const nameEl = $('overviewBotName');
  if (nameEl) nameEl.textContent = o.displayName || 'User';
  const lineEl = $('overviewTelegramLine');
  const running = Boolean(o.bot?.running);
  if (lineEl) {
    lineEl.textContent = running
      ? `Running (${o.bot.botCount || 0} bot${(o.bot.botCount || 0) === 1 ? '' : 's'})`
      : 'Stopped';
  }
  applyUserSidebarBotUi(o.bot || { running: false, botCount: 0, configuredBotCount: 0 });
  setStatusLed($('overviewTelegramLed'), running ? 'live' : 'idle');
  tickOverviewClock();
}

function renderDetailList(el, pairs) {
  if (!el) return;
  el.innerHTML =
    '<dl>' +
    pairs
      .map(
        ([k, v]) =>
          `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v == null || v === '' ? '—' : String(v))}</dd></div>`
      )
      .join('') +
    '</dl>';
}

async function populateTimezoneSelect(selected) {
  const sel = $('memUserTimezone');
  if (!sel) return;
  const data = await apiFetch('/api/user/timezones').then((r) => r.json());
  const list = data.timezones || [];
  const def = data.defaultTimezone || 'Asia/Rangoon';
  sel.innerHTML = '';
  for (const tz of list) {
    const o = document.createElement('option');
    o.value = tz;
    o.textContent = tz;
    sel.appendChild(o);
  }
  const want = selected || def;
  if ([...sel.options].some((o) => o.value === want)) sel.value = want;
  else {
    const o = document.createElement('option');
    o.value = want;
    o.textContent = want;
    sel.appendChild(o);
    sel.value = want;
  }
}

const userMemory = initUserMemory({ $, apiFetch, escapeHtml, setStatus, populateTimezoneSelect });

function renderChat(messages) {
  const thread = $('chatThread');
  if (!thread) return;
  if (!messages.length) {
    thread.innerHTML = '<p class="hint chat-empty">No messages yet.</p>';
    return;
  }
  thread.innerHTML = messages
    .map((m) => {
      const role = String(m.role || '').toLowerCase();
      if (role === 'system') return '';
      const cls = role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant';
      const who = role === 'user' ? 'You' : 'Assistant';
      return `<div class="${cls}"><span class="chat-who">${who}</span><div class="chat-text">${escapeHtml(
        m.content || ''
      )}</div></div>`;
    })
    .join('');
  thread.scrollTop = thread.scrollHeight;
}

async function loadChat() {
  const limit = $('chatLimit')?.value || '100';
  const data = await apiFetch(`/api/user/chat?limit=${encodeURIComponent(limit)}`).then((r) => r.json());
  if (data.error) throw new Error(data.error);
  renderChat(data.messages || []);
}

async function sendChat() {
  const text = $('chatInput')?.value?.trim() || '';
  if (!text) return;
  $('chatInput').value = '';
  setStatus('Sending…', '');
  const r = await apiFetch('/api/user/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Send failed');
  setStatus('', '');
  await loadChat();
}

function formatBotLabel(bot) {
  const un = bot?.botUsername ? `@${bot.botUsername}` : '';
  return un ? `${un} (${bot.botId})` : `Bot ${bot?.botId ?? '?'}`;
}

function renderUserTelegramBotList(bots) {
  const el = $('userTelegramBotList');
  if (!el) return;
  const list = Array.isArray(bots) ? bots : [];
  if (!list.length) {
    el.innerHTML = '<span class="hint">No bots connected yet.</span>';
    return;
  }
  el.innerHTML = list
    .map(
      (b) =>
        `<span class="telegram-token-chip"><span class="telegram-token-chip-label">${escapeHtml(
          formatBotLabel(b)
        )}: ${escapeHtml(b.tokenMasked || '')}</span><button type="button" class="btn-mini danger telegram-token-remove" data-user-bot-remove="${b.botId}" aria-label="Remove bot">Remove</button></span>`
    )
    .join('');
}

async function loadTelegram() {
  const t = await apiFetch('/api/user/telegram').then((r) => r.json());
  if (t.error) throw new Error(t.error);
  const linkRows = t.linked
    ? [
        ['Username', t.username ? `@${t.username}` : '—'],
        ['Telegram user id', t.telegramUserId ?? '—'],
        ['Email', t.email || '—'],
        ['Account status', t.status || '—'],
        ['Last seen', t.lastSeen || '—'],
      ]
    : [['Status', 'Not linked to Telegram yet']];
  renderDetailList($('telegramDetails'), linkRows);
  renderUserTelegramBotList(t.bots || []);
  const inp = $('userTelegramBotToken');
  if (inp) inp.value = '';
}

async function saveUserTelegramBotToken() {
  const tok = String($('userTelegramBotToken')?.value || '').trim();
  if (!tok) {
    setStatus('Paste a bot token first.', 'err');
    return;
  }
  setStatus('Connecting bot…', '');
  const r = await apiFetch('/api/user/telegram/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tok }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Failed to save token');
  setStatus('Bot connected.', 'ok');
  await loadTelegram();
}

async function removeUserTelegramBot(botId) {
  if (!window.confirm('Disconnect this bot? People waiting for approval will be cleared for this bot.')) return;
  setStatus('Removing bot…', '');
  const r = await apiFetch(`/api/user/telegram/bots/${botId}`, { method: 'DELETE' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Remove failed');
  setStatus('Bot removed.', 'ok');
  await loadTelegram();
}

function formatAccessUser(u) {
  if (u.username) return `@${u.username}`;
  if (u.firstName) return u.firstName;
  if (u.telegramUserId) return `id ${u.telegramUserId}`;
  return String(u.scopedUserId || '—');
}

async function setUserAccessStatus(id, status) {
  const r = await apiFetch(`/api/user/access/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Update failed');
}

async function loadAccess() {
  const a = await apiFetch('/api/user/access').then((r) => r.json());
  if (a.error) throw new Error(a.error);
  const users = Array.isArray(a.users) ? a.users : [];

  const pending = users.filter((u) => u.status === 'pending');
  $('userAccessPendingBody').innerHTML = pending.length
    ? pending
        .map(
          (u) =>
            `<tr><td>${escapeHtml(formatBotLabel({ botId: u.botId, botUsername: u.botUsername }))}</td><td>${escapeHtml(
              formatAccessUser(u)
            )}</td><td>${escapeHtml(u.firstMessagePreview || '—')}</td><td>${escapeHtml(
              u.createdAt || ''
            )}</td><td class="nowrap"><button type="button" class="btn-mini success" data-user-access-approve="${
              u.id
            }">Approve</button> <button type="button" class="btn-mini danger" data-user-access-block="${
              u.id
            }">Block</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="hint">No pending requests.</td></tr>';

  const approved = users.filter((u) => u.status === 'approved');
  $('userAccessApprovedBody').innerHTML = approved.length
    ? approved
        .map(
          (u) =>
            `<tr><td>${escapeHtml(formatBotLabel({ botId: u.botId, botUsername: u.botUsername }))}</td><td>${escapeHtml(
              formatAccessUser(u)
            )}</td><td>${escapeHtml(u.lastSeen || '')}</td><td class="nowrap"><button type="button" class="btn-mini danger" data-user-access-block="${
              u.id
            }">Block</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="hint">No approved users yet.</td></tr>';

  const blocked = users.filter((u) => u.status === 'blocked');
  $('userAccessBlockedBody').innerHTML = blocked.length
    ? blocked
        .map(
          (u) =>
            `<tr><td>${escapeHtml(formatBotLabel({ botId: u.botId, botUsername: u.botUsername }))}</td><td>${escapeHtml(
              formatAccessUser(u)
            )}</td><td class="nowrap"><button type="button" class="btn-mini success" data-user-access-approve="${
              u.id
            }">Approve</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="hint">None blocked.</td></tr>';
}

const calendarViewState = { year: new Date().getFullYear(), month: new Date().getMonth() };
let calendarEventsCache = [];

function formatEventTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function formatEventDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  try {
    return d.toLocaleString('en-US', { timeZone: userTimezone });
  } catch {
    return d.toLocaleString();
  }
}

function openCalendarDayModal(dayDate, events) {
  const modal = $('calendarDayModal');
  const title = $('calendarDayModalTitle');
  const body = $('calendarDayModalBody');
  if (!modal || !title || !body) return;

  title.textContent = `Events on ${dayDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  body.innerHTML = events
    .map((e) => {
      const createdAt = e.created_at ? formatEventDateTime(e.created_at) : '—';
      return `<article class="calendar-modal-event">
        <p><strong>Title:</strong> ${escapeHtml(e.title || '')}</p>
        <p><strong>Starts:</strong> ${escapeHtml(formatEventDateTime(e.starts_at))}</p>
        <p><strong>Created:</strong> ${escapeHtml(createdAt)}</p>
      </article>`;
    })
    .join('');
  modal.hidden = false;
}

function closeCalendarDayModal() {
  const modal = $('calendarDayModal');
  if (!modal) return;
  modal.hidden = true;
}

function renderCalendarMonth() {
  const grid = $('calMonthGrid');
  const label = $('calMonthLabel');
  if (!grid || !label) return;

  const year = calendarViewState.year;
  const month = calendarViewState.month;
  label.textContent = monthLabel(year, month);

  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  const eventsByDay = new Map();
  for (const e of calendarEventsCache) {
    const d = new Date(e.starts_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push(e);
  }
  for (const list of eventsByDay.values()) {
    list.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    const inMonth = day.getMonth() === month;
    const isToday = dayKey === todayKey;
    const events = eventsByDay.get(dayKey) || [];
    const eventsHtml = events.length
      ? events
          .map((e) => {
            const id = Number(e.id);
            const canDelete = Number.isFinite(id) ? String(id) : '';
            const time = formatEventTime(e.starts_at);
            return `<div class="cal-event-chip" title="${escapeHtml(e.title)}"><span class="cal-event-time">${escapeHtml(
              time
            )}</span><span class="cal-event-title">${escapeHtml(e.title)}</span><button type="button" class="btn-mini danger cal-event-delete" data-cal-delete="${canDelete}">×</button></div>`;
          })
          .join('')
      : '';
    cells.push(
      `<div class="cal-day${inMonth ? '' : ' is-outside'}${isToday ? ' is-today' : ''}${
        events.length ? ' has-events' : ''
      }" data-cal-day="${dayKey}"><div class="cal-day-number">${day.getDate()}</div><div class="cal-day-events">${
        eventsHtml || '<div class="cal-day-empty"></div>'
      }</div></div>`
    );
  }

  grid.innerHTML = cells.join('');
}

function shiftCalendarMonth(delta) {
  const next = new Date(calendarViewState.year, calendarViewState.month + delta, 1);
  calendarViewState.year = next.getFullYear();
  calendarViewState.month = next.getMonth();
  renderCalendarMonth();
}

function jumpCalendarToToday() {
  const now = new Date();
  calendarViewState.year = now.getFullYear();
  calendarViewState.month = now.getMonth();
  renderCalendarMonth();
}

async function loadCalendar() {
  const c = await apiFetch('/api/user/calendar').then((r) => r.json());
  if (c.error) throw new Error(c.error);
  calendarEventsCache = Array.isArray(c.events) ? c.events : [];
  renderCalendarMonth();
}

document.querySelectorAll('.nav-item[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    location.hash = btn.getAttribute('data-tab');
  });
});

window.addEventListener('hashchange', routeHash);

$('btnUserLogout')?.addEventListener('click', async () => {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login';
});

$('btnRefreshChat')?.addEventListener('click', () => loadChat().catch((e) => setStatus(e.message, 'err')));
$('btnClearChat')?.addEventListener('click', async () => {
  if (!confirm('Clear all your chat messages?')) return;
  const r = await apiFetch('/api/user/chat/clear', { method: 'POST' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Clear failed');
  await loadChat();
});
$('btnChatSend')?.addEventListener('click', () => sendChat().catch((e) => setStatus(e.message, 'err')));
$('chatInput')?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    sendChat().catch((e) => setStatus(e.message, 'err'));
  }
});
$('btnUserTelegramTokenSave')?.addEventListener('click', () =>
  saveUserTelegramBotToken().catch((e) => setStatus(e.message, 'err'))
);
$('userTelegramBotToken')?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    saveUserTelegramBotToken().catch((e) => setStatus(e.message, 'err'));
  }
});
$('panel-telegram')?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-user-bot-remove]');
  if (!btn) return;
  const botId = Number(btn.getAttribute('data-user-bot-remove'));
  if (!Number.isFinite(botId)) return;
  removeUserTelegramBot(botId).catch((e) => setStatus(e.message, 'err'));
});
$('btnRefreshUserAccess')?.addEventListener('click', () => loadAccess().catch((e) => setStatus(e.message, 'err')));
$('panel-access')?.addEventListener('click', async (ev) => {
  const approve = ev.target.closest('[data-user-access-approve]');
  const block = ev.target.closest('[data-user-access-block]');
  const id = Number((approve || block)?.getAttribute(approve ? 'data-user-access-approve' : 'data-user-access-block'));
  if (!Number.isFinite(id)) return;
  try {
    setStatus('Updating…', '');
    await setUserAccessStatus(id, approve ? 'approved' : 'blocked');
    setStatus(approve ? 'User approved.' : 'User blocked.', 'ok');
    await loadAccess();
  } catch (e) {
    setStatus(e.message, 'err');
  }
});
$('btnRefreshCalendar')?.addEventListener('click', () => loadCalendar().catch((e) => setStatus(e.message, 'err')));
$('btnCalPrev')?.addEventListener('click', () => shiftCalendarMonth(-1));
$('btnCalNext')?.addEventListener('click', () => shiftCalendarMonth(1));
$('btnCalToday')?.addEventListener('click', () => jumpCalendarToToday());

$('panel-calendar')?.addEventListener('click', async (ev) => {
  const dayCell = ev.target.closest('[data-cal-day]');
  if (dayCell && !ev.target.closest('[data-cal-delete]')) {
    const key = String(dayCell.getAttribute('data-cal-day') || '');
    if (key) {
      const dayEvents = calendarEventsCache
        .filter((e) => {
          const d = new Date(e.starts_at);
          if (Number.isNaN(d.getTime())) return false;
          return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === key;
        })
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
      if (dayEvents.length) {
        const [y, m, d] = key.split('-').map((n) => Number(n));
        openCalendarDayModal(new Date(y, m, d), dayEvents);
      }
    }
    return;
  }
  const btn = ev.target.closest('[data-cal-delete]');
  if (!btn) return;
  const id = Number(btn.getAttribute('data-cal-delete'));
  if (!Number.isFinite(id) || id < 1) return;
  if (!window.confirm('Delete this calendar event?')) return;
  setStatus('Deleting…', '');
  try {
    const r = await apiFetch(`/api/user/calendar/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'Delete failed');
    setStatus('Event deleted.', 'ok');
    await loadCalendar();
  } catch (e) {
    setStatus(e.message, 'err');
  }
});

$('calendarDayModal')?.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-cal-modal-close="backdrop"]')) {
    closeCalendarDayModal();
  }
});

$('btnCalendarModalClose')?.addEventListener('click', () => closeCalendarDayModal());

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && $('calendarDayModal') && !$('calendarDayModal').hidden) {
    closeCalendarDayModal();
  }
});

(async function init() {
  try {
    initCustomCursor();
    initNeuralBackgroundToggle();
    initNeuralBackground(document.getElementById('network'));
    initScrollIndicator();
    const auth = await apiFetch('/api/auth/me').then((r) => r.json());
    if (!auth.authenticated || auth.role !== 'user') {
      location.href = '/login';
      return;
    }
    if (!location.hash) location.hash = '#overview';
    routeHash();
    refreshUserSidebarBotUi().catch(() => {});
    setInterval(() => refreshUserSidebarBotUi().catch(() => {}), 5000);
    setInterval(() => {
      if ($('panel-overview')?.classList.contains('active')) {
        loadOverview().catch(() => {});
      }
    }, 8000);
  } catch (e) {
    setStatus(e.message, 'err');
  }
})();
