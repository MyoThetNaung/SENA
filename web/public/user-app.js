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
  if (name === 'data') loadMemory().catch((e) => setStatus(e.message, 'err'));
  if (name === 'chat') loadChat().catch((e) => setStatus(e.message, 'err'));
  if (name === 'telegram') loadTelegram().catch((e) => setStatus(e.message, 'err'));
  if (name === 'access') loadAccess().catch((e) => setStatus(e.message, 'err'));
  if (name === 'calendar') loadCalendar().catch((e) => setStatus(e.message, 'err'));
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

async function loadOverview() {
  const o = await apiFetch('/api/user/overview').then((r) => r.json());
  if (o.error) throw new Error(o.error);
  userTimezone = o.timezone || 'Asia/Rangoon';
  const nameEl = $('overviewBotName');
  if (nameEl) nameEl.textContent = o.displayName || 'User';
  const lineEl = $('overviewTelegramLine');
  const subEl = $('sidebarBotToggleSub');
  const running = Boolean(o.bot?.running);
  if (lineEl) {
    lineEl.textContent = running
      ? `Running (${o.bot.botCount || 0} bot${(o.bot.botCount || 0) === 1 ? '' : 's'})`
      : 'Stopped';
  }
  if (subEl) subEl.textContent = running ? 'RUNNING' : 'Stopped';
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

async function loadMemory() {
  const data = await apiFetch('/api/user/memory').then((r) => r.json());
  if (data.error) throw new Error(data.error);
  const soul = data.soul || {};
  const prof = soul.preferences?.profile || {};
  userTimezone = prof.timezone || userTimezone || 'Asia/Rangoon';
  await populateTimezoneSelect(userTimezone);
  if ($('memDisplayName')) $('memDisplayName').value = soul.display_name || '';
  if ($('memGender')) $('memGender').value = prof.gender || '';
  if ($('memWhoAmI')) $('memWhoAmI').value = prof.whoAmI || '';
  if ($('memExtra')) $('memExtra').value = prof.extra || '';
  if ($('memMemorySummary')) $('memMemorySummary').value = prof.memorySummary || '';
  const tbody = $('recordsBody');
  if (!tbody) return;
  const rows = data.records || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="hint">No saved rows yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.record_type)}</td><td>${escapeHtml(
          r.record_date || ''
        )}</td><td>${escapeHtml(r.title || '')}</td><td>${escapeHtml(r.amount ?? '')}</td><td>${escapeHtml(
          r.notes || ''
        )}</td></tr>`
    )
    .join('');
}

async function saveMemory() {
  const tz = $('memUserTimezone')?.value?.trim() || 'Asia/Rangoon';
  const body = {
    display_name: $('memDisplayName')?.value?.trim() || '',
    profile: {
      gender: $('memGender')?.value || '',
      whoAmI: $('memWhoAmI')?.value?.trim() || '',
      extra: $('memExtra')?.value?.trim() || '',
      memorySummary: $('memMemorySummary')?.value?.trim() || '',
      timezone: tz,
    },
  };
  const r = await apiFetch('/api/user/memory', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Save failed');
  userTimezone = tz;
  setStatus('Memory saved.', 'ok');
  tickOverviewClock();
}

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

async function loadTelegram() {
  const t = await apiFetch('/api/user/telegram').then((r) => r.json());
  if (t.error) throw new Error(t.error);
  if (!t.linked) {
    renderDetailList($('telegramDetails'), [['Status', 'Not linked to Telegram yet']]);
    return;
  }
  renderDetailList($('telegramDetails'), [
    ['Username', t.username ? `@${t.username}` : '—'],
    ['Telegram user id', t.telegramUserId ?? '—'],
    ['Email', t.email || '—'],
    ['Status', t.status || '—'],
    ['Last seen', t.lastSeen || '—'],
  ]);
}

async function loadAccess() {
  const a = await apiFetch('/api/user/access').then((r) => r.json());
  if (a.error) throw new Error(a.error);
  const e = a.entry;
  if (!e) {
    renderDetailList($('accessDetails'), [['Status', 'No invitation record found']]);
    return;
  }
  renderDetailList($('accessDetails'), [
    ['Email', e.email || '—'],
    ['Username', e.username ? `@${e.username}` : '—'],
    ['Status', e.status || '—'],
    ['Invited', e.invitedAt || '—'],
    ['First login', e.firstLoginAt || '—'],
    ['Last seen', e.lastSeen || '—'],
    ['Notes', e.notes || '—'],
  ]);
}

async function loadCalendar() {
  const c = await apiFetch('/api/user/calendar').then((r) => r.json());
  if (c.error) throw new Error(c.error);
  const tbody = $('calendarBody');
  if (!tbody) return;
  const events = c.events || [];
  if (!events.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="hint">No events yet.</td></tr>';
    return;
  }
  tbody.innerHTML = events
    .map((ev) => {
      let when = ev.starts_at || '';
      try {
        when = new Date(ev.starts_at).toLocaleString('en-US', { timeZone: userTimezone });
      } catch {
        /* keep raw */
      }
      return `<tr><td>${escapeHtml(when)}</td><td>${escapeHtml(ev.title || '')}</td><td class="nowrap"><button type="button" class="btn-mini danger" data-cal-del="${ev.id}">Delete</button></td></tr>`;
    })
    .join('');
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

$('btnSaveMem')?.addEventListener('click', () => saveMemory().catch((e) => setStatus(e.message, 'err')));
$('btnRefreshRecords')?.addEventListener('click', () => loadMemory().catch((e) => setStatus(e.message, 'err')));
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
$('btnRefreshCalendar')?.addEventListener('click', () => loadCalendar().catch((e) => setStatus(e.message, 'err')));
$('calendarBody')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-cal-del]');
  if (!btn) return;
  const id = btn.getAttribute('data-cal-del');
  if (!confirm('Delete this event?')) return;
  const r = await apiFetch(`/api/user/calendar/${id}`, { method: 'DELETE' });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || 'Delete failed');
  await loadCalendar();
});

(async function init() {
  try {
    const auth = await apiFetch('/api/auth/me').then((r) => r.json());
    if (!auth.authenticated || auth.role !== 'user') {
      location.href = '/login';
      return;
    }
    if (!location.hash) location.hash = '#overview';
    routeHash();
    setInterval(() => {
      if ($('panel-overview')?.classList.contains('active')) {
        loadOverview().catch(() => {});
      }
    }, 8000);
  } catch (e) {
    setStatus(e.message, 'err');
  }
})();
