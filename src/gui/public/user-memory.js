const WEB_BOT_KEY = 'web';

let userMemBotKey = WEB_BOT_KEY;
let userMemSessionId = null;
let userMemPrimaryId = null;
let userMemSessions = [];
let userMemAllSessions = [];
let userMemTelegramBots = [];

function botTabLabel(b) {
  if (b?.isWeb) return 'Web account';
  const un = b?.username ? `@${String(b.username).replace(/^@+/, '')}` : '';
  return un || `Bot ${b?.botId ?? '?'}`;
}

function memQuery(targetId, botKey) {
  const p = new URLSearchParams();
  if (targetId != null && targetId !== '') p.set('sessionUserId', String(targetId));
  if (botKey && botKey !== WEB_BOT_KEY) p.set('botId', String(botKey));
  const q = p.toString();
  return q ? `?${q}` : '';
}

export function initUserMemory({ $, apiFetch, escapeHtml, setStatus, populateTimezoneSelect }) {
  const sessionsQ = (botKey) =>
    botKey && botKey !== WEB_BOT_KEY
      ? `?botId=${encodeURIComponent(botKey)}`
      : '?botId=web';

  function renderBotSelect(bots) {
    const sel = $('userMemBotSelect');
    const hint = $('userMemBotHint');
    const list = [{ isWeb: true, botId: null }, ...(Array.isArray(bots) ? bots : [])];
    if (hint) {
      hint.hidden = list.length > 1;
      hint.textContent = 'Connect your bot token on the Telegram tab to see bot sessions here.';
    }
    if (!sel) return;
    sel.innerHTML = '';
    for (const b of list) {
      const key = b.isWeb ? WEB_BOT_KEY : String(b.botId);
      const o = document.createElement('option');
      o.value = key;
      o.textContent = botTabLabel(b);
      sel.appendChild(o);
    }
    if ([...sel.options].some((o) => o.value === userMemBotKey)) {
      sel.value = userMemBotKey;
    } else if (sel.options[0]) {
      sel.value = sel.options[0].value;
      userMemBotKey = sel.value;
    }
  }

  function fillSessionSelect(sessions, pickId) {
    const sel = $('userMemSessionSelect');
    if (!sel) return;
    userMemSessions = sessions;
    sel.innerHTML = '';
    if (!sessions.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'No sessions yet';
      sel.appendChild(o);
      return;
    }
    for (const s of sessions) {
      const o = document.createElement('option');
      o.value = String(s.userId);
      o.textContent = s.label;
      sel.appendChild(o);
    }
    const pick =
      pickId != null && sessions.some((s) => s.userId === Number(pickId))
        ? String(pickId)
        : String(sessions[0].userId);
    sel.value = pick;
    userMemSessionId = Number(pick);
  }

  async function loadAllSessionsForCopy() {
    const r = await apiFetch('/api/user/sessions').then((x) => x.json());
    if (r.error) throw new Error(r.error);
    userMemAllSessions = r.sessions || [];
    return userMemAllSessions;
  }

  function fillCopySelects(sessions, currentId) {
    const copyMem = $('memCopyFromSelect');
    const copyBot = $('memCopyBotFromSelect');
    const others = sessions.filter((s) => s.userId !== currentId);
    const html =
      '<option value="">Select source session…</option>' +
      others.map((s) => `<option value="${s.userId}">${escapeHtml(s.label)}</option>`).join('');
    if (copyMem) copyMem.innerHTML = html;
    if (copyBot) copyBot.innerHTML = html;
  }

  function applySoulToForm(soul) {
    const prof = soul.preferences?.profile || {};
    const bp = soul.preferences?.botPersona || {};
    populateTimezoneSelect(prof.timezone || 'Asia/Rangoon').catch(() => {});
    if ($('memDisplayName')) $('memDisplayName').value = soul.display_name || '';
    if ($('memGender')) $('memGender').value = prof.gender || '';
    if ($('memAge')) $('memAge').value = prof.age || '';
    if ($('memAddressUserEn')) $('memAddressUserEn').value = prof.addressUserEn || '';
    if ($('memAddressUserMy')) $('memAddressUserMy').value = prof.addressUserMy || '';
    if ($('memWhoAmI')) $('memWhoAmI').value = prof.whoAmI || '';
    if ($('memExtra')) $('memExtra').value = prof.extra || '';
    if ($('memMemorySummary')) $('memMemorySummary').value = prof.memorySummary || '';
    if ($('botDisplayName')) $('botDisplayName').value = bp.displayName || '';
    if ($('botDisplayNameMy')) $('botDisplayNameMy').value = bp.displayNameMy || '';
    if ($('botGender')) $('botGender').value = bp.gender || '';
    if ($('botStyle')) $('botStyle').value = bp.style || '';
    if ($('botRole')) $('botRole').value = bp.role || '';
  }

  function renderRecords(rows) {
    const tbody = $('recordsMemBody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="hint">No saved rows for this session.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.record_type)}</td><td>${escapeHtml(
            r.record_date || r.occurred_on || ''
          )}</td><td>${escapeHtml(r.title || '')}</td><td>${escapeHtml(r.amount ?? '')}</td><td>${escapeHtml(
            r.notes || ''
          )}</td><td><button type="button" class="danger ghost btn-delete-record-mem" data-record-id="${escapeHtml(
            String(r.id)
          )}">Remove</button></td></tr>`
      )
      .join('');
  }

  async function loadSoulsOverview() {
    const q =
      userMemBotKey && userMemBotKey !== WEB_BOT_KEY
        ? `?botId=${encodeURIComponent(userMemBotKey)}`
        : '';
    const r = await apiFetch(`/api/user/souls${q}`).then((x) => x.json());
    if (r.error) throw new Error(r.error);
    const tbody = $('userSoulsBody');
    if (!tbody) return;
    const souls = r.souls || [];
    if (!souls.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="hint">No soul rows yet.</td></tr>';
      return;
    }
    tbody.innerHTML = souls
      .map(
        (s) =>
          `<tr><td>${escapeHtml(s.userId)}</td><td>${escapeHtml(s.label)}</td><td>${escapeHtml(
            s.displayName || '—'
          )}</td><td>${escapeHtml(s.summaryPreview || '—')}</td><td class="nowrap"><button type="button" class="btn-mini primary ghost" data-user-soul-edit="${escapeHtml(
            s.userId
          )}" data-user-soul-bot="${s.botId != null ? escapeHtml(String(s.botId)) : WEB_BOT_KEY}">Edit</button></td></tr>`
      )
      .join('');
  }

  async function loadMemoryData(targetId, botKey) {
    const r = await apiFetch(`/api/user/memory${memQuery(targetId, botKey)}`).then((x) => x.json());
    if (r.error) throw new Error(r.error);
    applySoulToForm(r.soul || {});
    renderRecords(r.records || []);
    if (r.primaryUserId != null) userMemPrimaryId = r.primaryUserId;
    userMemSessionId = r.sessionUserId ?? targetId;
    fillCopySelects(userMemAllSessions, userMemSessionId);
    return r;
  }

  async function refreshMemory(targetId, botKey = userMemBotKey) {
    const sessR = await apiFetch(`/api/user/memory/sessions${sessionsQ(botKey)}`).then((x) => x.json());
    if (sessR.error) throw new Error(sessR.error);
    if (sessR.primaryUserId != null) userMemPrimaryId = sessR.primaryUserId;
    const list = sessR.sessions || [];
    userMemSessions = list;
    fillSessionSelect(list, targetId);
    await loadAllSessionsForCopy();
    await loadMemoryData(userMemSessionId, botKey);
    await loadSoulsOverview();
  }

  async function loadUserMemoryTab() {
    const botsR = await apiFetch('/api/user/memory/bots').then((x) => x.json());
    if (botsR.error) throw new Error(botsR.error);
    if (botsR.primaryUserId != null) userMemPrimaryId = botsR.primaryUserId;
    userMemTelegramBots = botsR.bots || [];
    renderBotSelect(userMemTelegramBots);
    await refreshMemory(null, userMemBotKey);
  }

  function showMemSubtab(name) {
    document.querySelectorAll('[data-user-mem-sub]').forEach((el) => {
      const on = el.getAttribute('data-user-mem-sub') === name;
      el.hidden = !on;
      el.classList.toggle('active', on);
    });
    document.querySelectorAll('[data-user-mem-sub-link]').forEach((a) => {
      const on = a.getAttribute('data-user-mem-sub-link') === name;
      a.classList.toggle('active', on);
      a.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  $('userMemBotSelect')?.addEventListener('change', (ev) => {
    const key = String(ev.target.value || WEB_BOT_KEY);
    if (!key || key === userMemBotKey) return;
    userMemBotKey = key;
    refreshMemory(null, key).catch((e) => setStatus(e.message, 'err'));
  });

  $('userMemSessionSelect')?.addEventListener('change', (ev) => {
    const n = Number(ev.target.value);
    if (!Number.isFinite(n)) return;
    userMemSessionId = n;
    loadMemoryData(n, userMemBotKey).catch((e) => setStatus(e.message, 'err'));
  });

  document.querySelectorAll('[data-user-mem-sub-link]').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      showMemSubtab(a.getAttribute('data-user-mem-sub-link'));
    });
  });

  $('btnSaveMemSession')?.addEventListener('click', async () => {
    const tz = $('memUserTimezone')?.value?.trim() || 'Asia/Rangoon';
    const body = {
      display_name: $('memDisplayName')?.value?.trim() || '',
      profile: {
        timezone: tz,
        gender: $('memGender')?.value || '',
        age: $('memAge')?.value || '',
        addressUserEn: $('memAddressUserEn')?.value?.trim() || '',
        addressUserMy: $('memAddressUserMy')?.value?.trim() || '',
        whoAmI: $('memWhoAmI')?.value?.trim() || '',
        extra: $('memExtra')?.value?.trim() || '',
        memorySummary: $('memMemorySummary')?.value?.trim() || '',
      },
    };
    const r = await apiFetch(`/api/user/memory${memQuery(userMemSessionId, userMemBotKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    setStatus('Session memory saved.', 'ok');
    await refreshMemory(userMemSessionId, userMemBotKey);
  });

  $('btnSaveBotPersona')?.addEventListener('click', async () => {
    const body = {
      botPersona: {
        displayName: $('botDisplayName')?.value?.trim() || '',
        displayNameMy: $('botDisplayNameMy')?.value?.trim() || '',
        gender: $('botGender')?.value || '',
        style: $('botStyle')?.value?.trim() || '',
        role: $('botRole')?.value?.trim() || '',
      },
    };
    const r = await apiFetch(`/api/user/memory${memQuery(userMemSessionId, userMemBotKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    setStatus('Assistant identity saved.', 'ok');
    await refreshMemory(userMemSessionId, userMemBotKey);
  });

  $('btnCopyMemSession')?.addEventListener('click', async () => {
    const to = Number(userMemSessionId);
    const from = Number($('memCopyFromSelect')?.value);
    if (!Number.isFinite(to) || !Number.isFinite(from) || from === to) {
      setStatus('Select a different source session.', 'err');
      return;
    }
    if (
      !confirm(
        `Copy memory from session ${from} into ${to}? Existing memory for this session will be replaced.`
      )
    ) {
      return;
    }
    const r = await apiFetch('/api/user/memory/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: from, toUserId: userMemSessionId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Copy failed');
    setStatus('Memory copied.', 'ok');
    await refreshMemory(userMemSessionId, userMemBotKey);
  });

  $('btnCopyBotPersona')?.addEventListener('click', async () => {
    const to = Number(userMemSessionId);
    const from = Number($('memCopyBotFromSelect')?.value);
    if (!Number.isFinite(to) || !Number.isFinite(from) || from === to) {
      setStatus('Select a different source session.', 'err');
      return;
    }
    if (
      !confirm(
        `Copy assistant identity from session ${from} into ${to}? Existing identity for this session will be replaced.`
      )
    ) {
      return;
    }
    const r = await apiFetch('/api/user/memory/copy-bot-persona', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: from, toUserId: userMemSessionId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Copy failed');
    setStatus('Assistant identity copied.', 'ok');
    await refreshMemory(userMemSessionId, userMemBotKey);
  });

  $('btnRefreshRecordsMem')?.addEventListener('click', () =>
    refreshMemory(userMemSessionId, userMemBotKey).catch((e) => setStatus(e.message, 'err'))
  );

  $('panel-data')?.addEventListener('click', (ev) => {
    const delRec = ev.target.closest('.btn-delete-record-mem');
    if (delRec) {
      const id = Number(delRec.getAttribute('data-record-id'));
      if (!Number.isFinite(id) || !Number.isFinite(userMemSessionId)) return;
      if (!confirm(`Delete saved table row #${id}?`)) return;
      (async () => {
        setStatus('Deleting row…', '');
        try {
          const r = await apiFetch(
            `/api/user/memory/records/delete${memQuery(userMemSessionId, userMemBotKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionUserId: userMemSessionId, id }),
            }
          );
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'Delete failed');
          setStatus('Row deleted.', 'ok');
          await loadMemoryData(userMemSessionId, userMemBotKey);
        } catch (e) {
          setStatus(e.message, 'err');
        }
      })();
      return;
    }
    const btn = ev.target.closest('[data-user-soul-edit]');
    if (!btn) return;
    const uid = Number(btn.getAttribute('data-user-soul-edit'));
    const botKey = btn.getAttribute('data-user-soul-bot') || WEB_BOT_KEY;
    userMemBotKey = botKey;
    showMemSubtab('session');
    refreshMemory(uid, botKey).catch((e) => setStatus(e.message, 'err'));
  });

  return { loadUserMemoryTab, showMemSubtab };
}
