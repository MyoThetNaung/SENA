const $ = (id) => document.getElementById(id);

/** Tabs nested under the Settings toggle (sidebar). */
const SETTINGS_SUB_TABS = new Set(['telegram', 'access', 'calendar', 'pending', 'system']);

function setSettingsGroupOpen(open) {
  const g = $('navSettingsGroup');
  const t = $('navSettingsToggle');
  if (!g || !t) return;
  g.classList.toggle('is-open', open);
  t.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncSettingsGroupForTab(name) {
  if (SETTINGS_SUB_TABS.has(name)) setSettingsGroupOpen(true);
}

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'statusbar ' + (kind || '');
}

function logLine(line) {
  const el = $('log');
  const t = new Date().toLocaleTimeString();
  el.textContent = `[${t}] ${line}\n` + el.textContent;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

function updateProviderVisibility() {
  const p = $('llmProvider').value;
  $('wrapOllama').classList.toggle('hidden', p !== 'ollama');
  $('wrapLlama').classList.toggle('hidden', p !== 'llama-server');
  const wrapSrv = $('wrapServerActions');
  if (wrapSrv) wrapSrv.classList.toggle('hidden', p !== 'llama-server');
}

const CHAT_SESSION_STORAGE_KEY = 'guiChatSessionUserId';

async function loadSettingsIntoForm() {
  const r = await fetch('/api/settings');
  if (!r.ok) throw new Error('Failed to load settings');
  const s = await r.json();

  $('projectRoot').textContent = s.projectRoot || '';

  $('telegramBotToken').value = '';
  $('allowedUserIds').value = s.allowedUserIds || '';
  $('ollamaBaseUrl').value = s.ollamaBaseUrl || 'http://127.0.0.1:11434';
  $('llamaServerUrl').value = s.llamaServerUrl || 'http://127.0.0.1:8080';
  $('llmProvider').value = s.llmProvider === 'llama-server' ? 'llama-server' : 'ollama';
  updateProviderVisibility();

  $('guiPort').value = s.guiPort || 3847;
  $('logLevel').value = s.logLevel || 'info';
  $('browserTimeoutMs').value = s.browserTimeoutMs ?? 10000;
  $('maxBrowsePages').value = s.maxBrowsePages ?? 2;
  $('databasePath').value = s.databasePath || '';
  $('databasePathResolved').textContent = s.databasePathResolved || '';
  $('modelsDir').value = s.modelsDirInput || 'models';
  $('modelsDirResolved').textContent = s.modelsDir || '';
  $('engineDir').value = s.engineDirInput || 'engine';
  $('engineDirResolved').textContent = s.engineDir || '';
  $('openBrowserGui').checked = Boolean(s.openBrowserGui);
  if ($('autoStartLlamaServer')) $('autoStartLlamaServer').checked = Boolean(s.autoStartLlamaServer);
  $('settingsPath').textContent = s.settingsPath || '';

  const hint = $('tokenHint');
  if (s.hasSavedToken && s.telegramBotTokenMasked) {
    hint.textContent = `Token active (ends ${s.telegramBotTokenMasked.slice(-4)}) — paste to replace.`;
  } else {
    hint.textContent = 'Paste token from @BotFather.';
  }

  const ggufEl = $('ggufList');
  $('ggufError').textContent = s.ggufError || '';
  if (s.ggufFiles && s.ggufFiles.length) {
    ggufEl.innerHTML =
      '<ul>' +
      s.ggufFiles
        .map(
          (f) =>
            `<li><strong>${escapeHtml(f.name)}</strong> — ${fmtSize(f.sizeBytes)}</li>`
        )
        .join('') +
      '</ul>';
  } else {
    ggufEl.innerHTML = '<p class="hint">No .gguf files in folder.</p>';
  }

  const uiModel = $('llmModel')?.value?.trim() || '';
  await refreshModelDropdown(uiModel || s.llmModel || '');

  const bp = s.botPersona || {};
  if ($('botDisplayName')) $('botDisplayName').value = bp.displayName || '';
  if ($('botGender')) {
    const g = String(bp.gender || '').trim().toLowerCase();
    if (g === 'male' || g === 'm') $('botGender').value = 'Male';
    else if (g === 'female' || g === 'f') $('botGender').value = 'Female';
    else if (bp.gender === 'Male' || bp.gender === 'Female') $('botGender').value = bp.gender;
    else $('botGender').value = '';
  }
  if ($('botStyle')) $('botStyle').value = bp.style || '';
  if ($('botRole')) $('botRole').value = bp.role || '';
  if ($('botAddressUserEn')) $('botAddressUserEn').value = bp.addressUserEn || '';
  if ($('botAddressUserMy')) $('botAddressUserMy').value = bp.addressUserMy || '';
}

async function refreshModelDropdown(selected) {
  const hint = $('catalogHint');
  hint.textContent = 'Loading model list…';
  try {
    const r = await fetch('/api/llm/catalog');
    const c = await r.json();
    if (!r.ok) throw new Error(c.error || 'catalog failed');

    const sel = $('llmModel');
    const opts = c.options || [];
    sel.innerHTML = '';
    if (!opts.length) {
      const o = document.createElement('option');
      o.value = selected || 'default';
      o.textContent = selected || '(type model name)';
      sel.appendChild(o);
    } else {
      for (const opt of opts) {
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.label || opt.id;
        sel.appendChild(o);
      }
    }
    const want = selected || c.selectedModel || '';
    if (want && [...sel.options].some((x) => x.value === want)) {
      sel.value = want;
    } else if (want) {
      const o = document.createElement('option');
      o.value = want;
      o.textContent = want + ' (custom)';
      sel.appendChild(o);
      sel.value = want;
    }

    const parts = [];
    parts.push(`Backend: ${c.provider}`);
    if (c.remoteOk) parts.push('Remote API: OK');
    else parts.push(`Remote API: ${c.remoteError || 'unreachable'}`);
    hint.textContent = parts.join(' · ');
  } catch (e) {
    hint.textContent = 'Could not load catalog: ' + e.message;
  }
}

function showTab(name) {
  for (const p of document.querySelectorAll('.tab-panel')) {
    p.classList.toggle('active', p.id === 'panel-' + name);
  }
  for (const b of document.querySelectorAll('.nav-item')) {
    b.classList.toggle('active', b.getAttribute('data-tab') === name);
  }
  if (name === 'overview') {
    loadOverview();
    startOverviewHardwarePolling();
  } else {
    stopOverviewHardwarePolling();
  }
  if (name === 'access') loadAccess();
  if (name === 'data') loadDataTab().catch((e) => setStatus(e.message, 'err'));
  if (name === 'chat') loadChat();
  if (name === 'calendar') loadCalendar();
  if (name === 'pending') loadPending();
  syncSettingsGroupForTab(name);
}

function setStatusLed(el, state) {
  if (!el) return;
  el.classList.remove('is-live', 'is-warn', 'is-idle', 'is-unknown');
  if (state === 'live') {
    el.classList.add('is-live');
    el.title = 'Online';
  } else if (state === 'warn') {
    el.classList.add('is-warn');
    el.title = 'Starting or degraded';
  } else if (state === 'idle') {
    el.classList.add('is-idle');
    el.title = 'Stopped or unreachable';
  } else {
    el.classList.add('is-unknown');
    el.title = 'Unknown';
  }
}

function formatLlmBackendLabel(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'llama-server') return 'llama.cpp server (OpenAI API)';
  return 'Ollama';
}

function setGaugeRing(gaugeEl, midEl, pct, emptyLabel = '—') {
  if (!gaugeEl || !midEl) return;
  if (pct != null && Number.isFinite(pct)) {
    const p = Math.min(100, Math.max(0, pct));
    gaugeEl.style.setProperty('--p', String(p));
    midEl.textContent = `${Math.round(p * 10) / 10}%`;
  } else {
    gaugeEl.style.setProperty('--p', '0');
    midEl.textContent = emptyLabel;
  }
}

function setTempLabel(el, celsius) {
  if (!el) return;
  el.textContent =
    celsius != null && Number.isFinite(celsius) ? `${Math.round(celsius)}°C` : '—';
}

function setCpuCoresLine(el, n) {
  if (!el) return;
  if (n != null && Number.isFinite(n) && n > 0) {
    const c = Math.round(n);
    el.textContent = c === 1 ? '1 core' : `${c} cores`;
  } else {
    el.textContent = '—';
  }
}

/** Show CPU °C only when a reading exists; otherwise hide the row (no placeholder). */
function setCpuTempLine(el, celsius) {
  if (!el) return;
  if (celsius != null && Number.isFinite(celsius)) {
    el.textContent = `${Math.round(celsius)}°C`;
    el.hidden = false;
    el.removeAttribute('aria-hidden');
  } else {
    el.textContent = '';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
  }
}

/** nvidia-smi / OS report memory in MiB */
function formatGiBFromMib(mib) {
  if (mib == null || !Number.isFinite(mib) || mib < 0) return null;
  const gib = mib / 1024;
  if (gib >= 100) return `${Math.round(gib)} GB`;
  const x = Math.round(gib * 10) / 10;
  const s = Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, '');
  return `${s} GB`;
}

function setMemGiBPairLine(el, usedMb, totalMb) {
  if (!el) return;
  const u = formatGiBFromMib(usedMb);
  const t = formatGiBFromMib(totalMb);
  if (u && t) el.textContent = `${u} / ${t}`;
  else el.textContent = '—';
}

function setHardwareMeters(hw) {
  const gCpu = $('overviewGaugeCpu');
  const gRam = $('overviewGaugeRam');
  const gGpu = $('overviewGaugeGpu');
  const gVram = $('overviewGaugeVram');
  const mCpu = $('overviewGaugeCpuMid');
  const mRam = $('overviewGaugeRamMid');
  const mGpu = $('overviewGaugeGpuMid');
  const mVram = $('overviewGaugeVramMid');
  const cpuCoresEl = $('overviewCpuCores');
  const tCpu = $('overviewTempCpu');
  const ramDetail = $('overviewRamDetail');
  const tGpu = $('overviewTempGpu');
  const vramDetail = $('overviewVramDetail');
  const meta = $('overviewHwMeta');

  if (!gCpu || !gRam || !mCpu || !mRam) return;

  if (!hw || typeof hw !== 'object' || hw.error) {
    [gCpu, gRam, gGpu, gVram].forEach((g) => g?.style.setProperty('--p', '0'));
    [mCpu, mRam, mGpu, mVram].forEach((m) => {
      if (m) m.textContent = '—';
    });
    setCpuCoresLine(cpuCoresEl, null);
    setCpuTempLine(tCpu, null);
    setMemGiBPairLine(ramDetail, null, null);
    setTempLabel(tGpu, null);
    setMemGiBPairLine(vramDetail, null, null);
    if (meta) meta.textContent = '';
    return;
  }

  setGaugeRing(gCpu, mCpu, hw.cpuPercent);
  setGaugeRing(gRam, mRam, Number(hw.memoryUsedPercent));

  if (hw.gpuAvailable && hw.gpuLoadPercent != null && Number.isFinite(hw.gpuLoadPercent)) {
    setGaugeRing(gGpu, mGpu, hw.gpuLoadPercent);
  } else {
    gGpu?.style.setProperty('--p', '0');
    if (mGpu) mGpu.textContent = '—';
  }

  if (hw.gpuAvailable && hw.gpuMemoryPercent != null && Number.isFinite(hw.gpuMemoryPercent)) {
    setGaugeRing(gVram, mVram, hw.gpuMemoryPercent);
  } else {
    gVram?.style.setProperty('--p', '0');
    if (mVram) mVram.textContent = '—';
  }

  if (hw.gpuAvailable && hw.gpuMemoryUsedMb != null && hw.gpuMemoryTotalMb != null) {
    setMemGiBPairLine(vramDetail, hw.gpuMemoryUsedMb, hw.gpuMemoryTotalMb);
  } else {
    setMemGiBPairLine(vramDetail, null, null);
  }

  setCpuCoresLine(cpuCoresEl, hw.cpuCores);
  setCpuTempLine(tCpu, hw.cpuTempC);
  setMemGiBPairLine(ramDetail, hw.memoryUsedMb, hw.memoryTotalMb);
  setTempLabel(tGpu, hw.gpuTempC);

  if (meta) {
    meta.textContent =
      hw.monitoringSource === 'OpenHardwareMonitor' ? 'Sensors: Open Hardware Monitor' : '';
  }
}

const HARDWARE_HISTORY_MAX = 60;
const HARDWARE_POLL_MS = 2000;
let hardwareHistCpu = [];
let hardwareHistRam = [];
let hardwareHistGpu = [];
let hardwareChartTimer = null;

function clearHardwareHistory() {
  hardwareHistCpu = [];
  hardwareHistRam = [];
  hardwareHistGpu = [];
}

function pushHardwareHistory(hw) {
  const cpu = hw.cpuPercent != null && Number.isFinite(hw.cpuPercent) ? hw.cpuPercent : null;
  const ramP = Number(hw.memoryUsedPercent);
  const ram = Number.isFinite(ramP) ? ramP : null;
  let gpu = null;
  if (hw.gpuAvailable && hw.gpuLoadPercent != null && Number.isFinite(hw.gpuLoadPercent)) {
    gpu = hw.gpuLoadPercent;
  }
  function push(arr, v) {
    arr.push(v);
    if (arr.length > HARDWARE_HISTORY_MAX) arr.shift();
  }
  push(hardwareHistCpu, cpu);
  push(hardwareHistRam, ram);
  push(hardwareHistGpu, gpu);
}

function setupUsageChartCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(80, Math.floor(rect.width));
  const h = Math.max(48, Math.floor(rect.height));
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawPercentLineChart(canvas, series, strokeRgb, fillRgb) {
  const o = setupUsageChartCanvas(canvas);
  if (!o) return;
  const { ctx, w, h } = o;
  const pad = 4;
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
  for (const pct of [50]) {
    const y = pad + (1 - pct / 100) * (h - 2 * pad);
    ctx.strokeStyle = '#243044';
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  const hasAny = series.some((v) => v != null && Number.isFinite(v));
  if (!hasAny) {
    ctx.fillStyle = '#5c6b7a';
    ctx.font = '11px system-ui, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', w / 2, h / 2);
    return;
  }

  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;
  const n = series.length;
  const xAt = (i) => (n <= 1 ? pad + innerW / 2 : pad + (i / (n - 1)) * innerW);
  const yAt = (v) => pad + (1 - Math.min(100, Math.max(0, v)) / 100) * innerH;

  const segments = [];
  let cur = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) {
      cur.push({ i, v });
    } else if (cur.length) {
      segments.push(cur);
      cur = [];
    }
  }
  if (cur.length) segments.push(cur);

  for (const seg of segments) {
    if (seg.length < 2) continue;
    const [r, g, b] = fillRgb;
    ctx.beginPath();
    ctx.moveTo(xAt(seg[0].i), yAt(seg[0].v));
    for (let k = 1; k < seg.length; k++) {
      ctx.lineTo(xAt(seg[k].i), yAt(seg[k].v));
    }
    ctx.lineTo(xAt(seg[seg.length - 1].i), h - pad);
    ctx.lineTo(xAt(seg[0].i), h - pad);
    ctx.closePath();
    ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
    ctx.fill();
  }

  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const seg of segments) {
    if (seg.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = `rgb(${strokeRgb[0]},${strokeRgb[1]},${strokeRgb[2]})`;
    ctx.moveTo(xAt(seg[0].i), yAt(seg[0].v));
    for (let k = 1; k < seg.length; k++) {
      ctx.lineTo(xAt(seg[k].i), yAt(seg[k].v));
    }
    ctx.stroke();
  }

  for (const seg of segments) {
    if (seg.length !== 1) continue;
    const p = seg[0];
    ctx.beginPath();
    ctx.fillStyle = `rgb(${strokeRgb[0]},${strokeRgb[1]},${strokeRgb[2]})`;
    ctx.arc(xAt(p.i), yAt(p.v), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function redrawHardwareCharts() {
  const cCpu = $('overviewChartCpu');
  const cRam = $('overviewChartRam');
  const cGpu = $('overviewChartGpu');
  if (cCpu) drawPercentLineChart(cCpu, hardwareHistCpu, [14, 165, 233], [14, 165, 233]);
  if (cRam) drawPercentLineChart(cRam, hardwareHistRam, [99, 102, 241], [99, 102, 241]);
  if (cGpu) drawPercentLineChart(cGpu, hardwareHistGpu, [168, 85, 247], [168, 85, 247]);
}

async function refreshOverviewHardware() {
  try {
    const r = await fetch('/api/system/hardware');
    const hw = await r.json();
    if (!r.ok || hw.error) throw new Error(hw.error || 'hardware');
    setHardwareMeters(hw);
    pushHardwareHistory(hw);
    redrawHardwareCharts();
  } catch {
    setHardwareMeters(null);
  }
}

function stopOverviewHardwarePolling() {
  if (hardwareChartTimer) {
    clearInterval(hardwareChartTimer);
    hardwareChartTimer = null;
  }
}

function startOverviewHardwarePolling() {
  stopOverviewHardwarePolling();
  clearHardwareHistory();
  redrawHardwareCharts();
  refreshOverviewHardware();
  hardwareChartTimer = setInterval(refreshOverviewHardware, HARDWARE_POLL_MS);
}

async function loadOverview() {
  try {
    const settings = await (await fetch('/api/settings')).json();
    const display = String(settings.botPersona?.displayName || '').trim();
    const nameEl = $('overviewBotName');
    const cardName = $('overviewCardBotName');
    if (nameEl) {
      nameEl.textContent = display || '—';
    }
    if (cardName) {
      cardName.classList.toggle('status-card-active', Boolean(display));
    }

    const backEl = $('overviewLlmBackend');
    if (backEl) backEl.textContent = formatLlmBackendLabel(settings.llmProvider);
    const llamaUrlEl = $('overviewLlamaServerUrl');
    if (llamaUrlEl) {
      const u = String(settings.llamaServerUrl || '').trim();
      llamaUrlEl.textContent = u || '—';
    }
    const modelEl = $('overviewActiveModel');
    if (modelEl) {
      const m = String(settings.llmModel || '').trim();
      modelEl.textContent = m || '—';
    }
  } catch {
    const nameEl = $('overviewBotName');
    const cardName = $('overviewCardBotName');
    if (nameEl) nameEl.textContent = '—';
    cardName?.classList.remove('status-card-active');
    const backEl = $('overviewLlmBackend');
    if (backEl) backEl.textContent = '—';
    const llamaUrlEl = $('overviewLlamaServerUrl');
    if (llamaUrlEl) llamaUrlEl.textContent = '—';
    const modelEl = $('overviewActiveModel');
    if (modelEl) modelEl.textContent = '—';
  }

  try {
    const st = await (await fetch('/api/bot/status')).json();
    const running = Boolean(st.running);
    const starting = Boolean(st.starting);
    const line = $('overviewTelegramLine');
    const card = $('overviewCardTelegram');
    if (line) {
      line.textContent = running ? 'Running' : starting ? 'Starting…' : 'Stopped';
    }
    if (running) {
      setStatusLed($('overviewTelegramLed'), 'live');
      card?.classList.add('status-card-active');
    } else if (starting) {
      setStatusLed($('overviewTelegramLed'), 'warn');
      card?.classList.add('status-card-active');
    } else {
      setStatusLed($('overviewTelegramLed'), 'idle');
      card?.classList.remove('status-card-active');
    }
  } catch {
    const line = $('overviewTelegramLine');
    const card = $('overviewCardTelegram');
    if (line) line.textContent = '?';
    card?.classList.remove('status-card-active');
    setStatusLed($('overviewTelegramLed'), 'unknown');
  }

  try {
    const ss = await (await fetch('/api/llm/server-status')).json();
    const prov = String(ss.provider || '');
    const online = Boolean(ss.online);
    const spawned = Boolean(ss.spawnedByApp);
    const lineEl = $('overviewServerLine');
    const subEl = $('overviewServerDetail');
    const cardS = $('overviewCardServer');

    if (lineEl) {
      lineEl.textContent = online ? 'Online' : 'Offline';
    }
    if (subEl) {
      subEl.textContent =
        prov === 'llama-server' && spawned ? 'Started by this app' : '';
    }
    if (online) {
      setStatusLed($('overviewServerLed'), 'live');
      cardS?.classList.add('status-card-active');
    } else {
      setStatusLed($('overviewServerLed'), 'idle');
      cardS?.classList.remove('status-card-active');
    }
  } catch {
    const lineEl = $('overviewServerLine');
    const subEl = $('overviewServerDetail');
    const cardS = $('overviewCardServer');
    if (lineEl) lineEl.textContent = '?';
    if (subEl) subEl.textContent = '';
    cardS?.classList.remove('status-card-active');
    setStatusLed($('overviewServerLed'), 'unknown');
  }

}

async function loadAccess() {
  const r = await fetch('/api/access/users');
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'access list failed');
  const users = d.users || [];

  const pend = users.filter((u) => u.status === 'pending');
  $('accessPendingBody').innerHTML = pend.length
    ? pend
        .map(
          (u) =>
            `<tr><td>${u.user_id}</td><td>${escapeHtml(u.username || '')}</td><td>${escapeHtml(
              u.first_name || ''
            )}</td><td class="msg">${escapeHtml(u.first_message_preview || '')}</td><td>${escapeHtml(
              u.created_at || ''
            )}</td><td class="nowrap"><button type="button" class="btn-mini success" data-access-act="approved" data-uid="${
              u.user_id
            }">Approve</button> <button type="button" class="btn-mini danger" data-access-act="blocked" data-uid="${
              u.user_id
            }">Deny</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="hint">No pending users.</td></tr>';

  const appr = users.filter((u) => u.status === 'approved');
  $('accessApprovedBody').innerHTML = appr.length
    ? appr
        .map(
          (u) =>
            `<tr><td>${u.user_id}</td><td>${escapeHtml(u.username || '')}</td><td>${escapeHtml(
              u.last_seen || ''
            )}</td><td class="nowrap"><button type="button" class="btn-mini ghost" data-access-act="pending" data-uid="${
              u.user_id
            }">Revoke</button> <button type="button" class="btn-mini danger" data-access-act="blocked" data-uid="${
              u.user_id
            }">Block</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="hint">None yet.</td></tr>';

  const blk = users.filter((u) => u.status === 'blocked');
  $('accessBlockedBody').innerHTML = blk.length
    ? blk
        .map(
          (u) =>
            `<tr><td>${u.user_id}</td><td>${escapeHtml(u.username || '')}</td><td class="nowrap"><button type="button" class="btn-mini success" data-access-act="approved" data-uid="${u.user_id}">Approve</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="hint">None.</td></tr>';
}

document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-access-act]');
  if (!btn) return;
  const uid = Number(btn.dataset.uid);
  const status = btn.dataset.accessAct;
  if (!Number.isFinite(uid) || !status) return;
  try {
    const r = await fetch('/api/access/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, status }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Update failed');
    logLine(`Access ${uid} → ${status}`);
    await loadAccess();
    await loadOverview();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Access: ' + e.message);
  }
});

async function loadSouls() {
  const r = await fetch('/api/data/souls');
  const d = await r.json();
  const rows = (d.souls || []).map((u) => {
    const sum = u.preferences?.profile?.memorySummary
      ? String(u.preferences.profile.memorySummary).slice(0, 120)
      : '';
    return `<tr><td>${u.user_id}</td><td>${escapeHtml(u.display_name || '')}</td><td class="msg">${escapeHtml(
      sum || '—'
    )}</td><td>${escapeHtml(u.updated_at || '')}</td></tr>`;
  });
  $('soulBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="4" class="hint">No rows.</td></tr>';
}

function mapProfileGenderToSelect(raw) {
  const g = String(raw || '').trim().toLowerCase();
  if (g === 'male' || g === 'm') return 'Male';
  if (g === 'female' || g === 'f') return 'Female';
  if (g === 'other') return 'Other';
  if (raw === 'Male' || raw === 'Female' || raw === 'Other') return raw;
  return '';
}

function mapProfileAgeToSelect(raw) {
  const s = String(raw || '').trim();
  const buckets = ['Under 13', '13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  if (buckets.includes(s)) return s;
  const legacy = s.replace(/\u2013/g, '-');
  if (buckets.includes(legacy)) return legacy;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 13) return 'Under 13';
  if (n <= 17) return '13-17';
  if (n <= 24) return '18-24';
  if (n <= 34) return '25-34';
  if (n <= 44) return '35-44';
  if (n <= 54) return '45-54';
  if (n <= 64) return '55-64';
  return '65+';
}

function applySoulToMemForm(soul) {
  if (!$('memDisplayName')) return;
  $('memDisplayName').value = soul.display_name || '';
  const prof = (soul.preferences && soul.preferences.profile) || {};
  $('memWhoAmI').value = prof.whoAmI || '';
  $('memWork').value = prof.work || '';
  if ($('memGender')) $('memGender').value = mapProfileGenderToSelect(prof.gender);
  if ($('memAge')) $('memAge').value = mapProfileAgeToSelect(prof.age);
  $('memExtra').value = prof.extra || '';
  if ($('memMemorySummary')) $('memMemorySummary').value = prof.memorySummary || '';
}

async function loadMemorySessionsIntoSelects() {
  const d = await fetch('/api/memory/sessions').then((r) => r.json());
  if (d.error) throw new Error(d.error);
  const sessions = d.sessions || [];
  const memSel = $('memSessionSelect');
  const copySel = $('memCopyFromSelect');
  if (!memSel || !copySel) return;
  const prevMem = memSel.value;
  const prevCopy = copySel.value;
  memSel.innerHTML = '';
  copySel.innerHTML = '<option value="">Select source session…</option>';
  for (const s of sessions) {
    const o = document.createElement('option');
    o.value = String(s.userId);
    o.textContent = `${s.label} · ${s.userId}`;
    memSel.appendChild(o);
    const c = document.createElement('option');
    c.value = String(s.userId);
    c.textContent = `${s.label} · ${s.userId}`;
    copySel.appendChild(c);
  }
  if (prevMem && [...memSel.options].some((x) => x.value === prevMem)) memSel.value = prevMem;
  if (prevCopy && [...copySel.options].some((x) => x.value === prevCopy)) copySel.value = prevCopy;
}

async function loadSoulForCurrentMemSession() {
  const uid = Number($('memSessionSelect')?.value);
  if (!Number.isFinite(uid)) return;
  const r = await fetch(`/api/soul/${uid}`);
  const soul = await r.json();
  if (soul.error) throw new Error(soul.error);
  applySoulToMemForm(soul);
}

async function loadDataTab() {
  await loadSouls();
  await loadMemorySessionsIntoSelects();
  await loadSoulForCurrentMemSession();
}

function getGuiConsoleUserIdFromData(data) {
  return data?.guiConsoleUserId != null ? Number(data.guiConsoleUserId) : 900000001;
}

function buildSessionSelect(sessionsPayload) {
  const guiId = getGuiConsoleUserIdFromData(sessionsPayload);
  const sessions = sessionsPayload?.sessions || [];
  const sel = $('chatSessionSelect');
  if (!sel) return guiId;
  const prev = sel.value;
  sel.innerHTML = '';
  const oGui = document.createElement('option');
  oGui.value = String(guiId);
  oGui.textContent = 'Control panel (local test)';
  sel.appendChild(oGui);
  const seen = new Set([guiId]);
  for (const s of sessions) {
    const o = document.createElement('option');
    o.value = String(s.userId);
    o.textContent = `${s.label} · ${s.userId}`;
    sel.appendChild(o);
    seen.add(s.userId);
  }
  const saved = localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
  const pick =
    (saved && [...sel.options].some((x) => x.value === saved) && saved) ||
    (prev && [...sel.options].some((x) => x.value === prev) && prev) ||
    String(guiId);
  sel.value = pick;
  const hint = $('chatSessionHint');
  if (hint) {
    const uid = Number(sel.value);
    const opt = sel.selectedOptions[0];
    hint.textContent = `Active user id: ${uid} — ${opt ? opt.textContent : ''}`;
  }
  return guiId;
}

function renderChatThread(messages) {
  const thread = $('chatThread');
  if (!thread) return;
  const list = messages || [];
  if (!list.length) {
    thread.innerHTML = '<p class="hint chat-empty">No messages in this session yet.</p>';
    return;
  }
  const parts = [];
  for (const m of list) {
    const role = String(m.role || '').toLowerCase();
    if (role === 'system') continue;
    const t = m.created_at ? new Date(m.created_at).toLocaleString() : '';
    const cls = role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant';
    const who = role === 'user' ? 'You' : 'Assistant';
    parts.push(
      `<div class="${cls}"><span class="chat-meta">${escapeHtml(t)} · ${escapeHtml(who)}</span><div class="chat-text">${escapeHtml(
        m.content || ''
      ).replace(/\n/g, '<br/>')}</div></div>`
    );
  }
  thread.innerHTML = parts.join('');
  thread.scrollTop = thread.scrollHeight;
}

async function loadChat() {
  const limit = $('chatLimit')?.value || '100';
  const sess = await fetch('/api/chat/sessions').then((r) => r.json());
  if (sess.error) throw new Error(sess.error);
  buildSessionSelect(sess);
  const activeUid = Number($('chatSessionSelect')?.value);
  localStorage.setItem(CHAT_SESSION_STORAGE_KEY, String(activeUid));
  const q = new URLSearchParams({ limit });
  q.set('userId', String(activeUid));
  const data = await fetch('/api/chat?' + q.toString()).then((r) => r.json());
  if (data.error) throw new Error(data.error);
  renderChatThread(data.messages || []);
}

async function sendChatFromGui() {
  const input = $('chatInput');
  const text = (input?.value || '').trim();
  if (!text) return;
  const sel = $('chatSessionSelect');
  const userId = Number(sel?.value);
  if (!Number.isFinite(userId)) {
    setStatus('Pick a session first.', 'err');
    return;
  }
  setStatus('Sending…', '');
  input.disabled = true;
  try {
    const r = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, text }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Send failed');
    input.value = '';
    if (j.wantConfirmKeyboard) {
      logLine('Assistant asked for Yes/No — type Yes or No in the chat box.');
    }
    setStatus('Sent.', 'ok');
    await loadChat();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Chat: ' + e.message);
    await loadChat().catch(() => {});
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function loadCalendar() {
  const r = await fetch('/api/data/calendar?limit=500');
  const d = await r.json();
  const rows = (d.events || []).map((e) => {
    const when = e.starts_at ? new Date(e.starts_at).toLocaleString() : '';
    return `<tr><td>${escapeHtml(when)}</td><td>${e.user_id}</td><td class="msg">${escapeHtml(e.title)}</td></tr>`;
  });
  $('calBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3" class="hint">No events.</td></tr>';
}

async function loadPending() {
  const r = await fetch('/api/data/pending');
  const d = await r.json();
  const rows = (d.pending || []).map((p) => {
    const payload =
      typeof p.payload === 'object' ? JSON.stringify(p.payload) : String(p.payload || '');
    return `<tr><td>${p.user_id}</td><td>${escapeHtml(p.kind)}</td><td class="msg">${escapeHtml(payload)}</td><td>${escapeHtml(
      p.created_at || ''
    )}</td></tr>`;
  });
  $('pendingBody').innerHTML = rows.length
    ? rows.join('')
    : '<tr><td colspan="4" class="hint">None.</td></tr>';
}

async function saveAll() {
  setStatus('Saving…', '');
  try {
    const body = {
      allowedUserIds: $('allowedUserIds').value.trim(),
      llmProvider: $('llmProvider').value,
      ollamaBaseUrl: $('ollamaBaseUrl').value.trim(),
      llamaServerUrl: $('llamaServerUrl').value.trim(),
      llmModel: $('llmModel').value.trim(),
      guiPort: $('guiPort').value,
      logLevel: $('logLevel').value,
      browserTimeoutMs: $('browserTimeoutMs').value,
      maxBrowsePages: $('maxBrowsePages').value,
      databasePath: $('databasePath').value.trim(),
      modelsDir: $('modelsDir').value.trim(),
      engineDir: $('engineDir').value.trim(),
      openBrowserGui: $('openBrowserGui').checked,
      autoStartLlamaServer: $('autoStartLlamaServer') ? $('autoStartLlamaServer').checked : false,
    };
    const tok = $('telegramBotToken').value.trim();
    if (tok) body.telegramBotToken = tok;
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    logLine('Settings saved.');
    setStatus('Saved.', 'ok');
    await loadSettingsIntoForm();
    await loadOverview();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Save error: ' + e.message);
  }
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    location.hash = btn.getAttribute('data-tab');
  });
});

$('navSettingsToggle')?.addEventListener('click', (e) => {
  e.preventDefault();
  const g = $('navSettingsGroup');
  if (!g) return;
  setSettingsGroupOpen(!g.classList.contains('is-open'));
});

$('llmProvider').addEventListener('change', () => {
  updateProviderVisibility();
  refreshModelDropdown($('llmModel').value);
});

$('btnRefreshModels').addEventListener('click', () => refreshModelDropdown($('llmModel').value));

$('btnSave').addEventListener('click', saveAll);

$('btnStart').addEventListener('click', async () => {
  setStatus('Starting…', '');
  try {
    const r = await fetch('/api/bot/start', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Start failed');
    logLine('Bot started.');
    setStatus('Bot running.', 'ok');
    await loadOverview();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Start: ' + e.message);
  }
});

$('btnStop').addEventListener('click', async () => {
  setStatus('Stopping…', '');
  try {
    const r = await fetch('/api/bot/stop', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Stop failed');
    logLine('Bot stopped.');
    setStatus('Stopped.', '');
    await loadOverview();
  } catch (e) {
    setStatus(e.message, 'err');
  }
});

if ($('btnStartServer')) {
  $('btnStartServer').addEventListener('click', async () => {
    setStatus('Starting llama-server…', '');
    try {
      const r = await fetch('/api/llm/start-server', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Start server failed');
      logLine(j.skipped ? 'llama-server already responding.' : 'llama-server started.');
      setStatus(j.skipped ? 'Server already running.' : 'Server running.', 'ok');
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Start server: ' + e.message);
    }
  });
}
if ($('btnStopServer')) {
  $('btnStopServer').addEventListener('click', async () => {
    setStatus('Stopping llama-server…', '');
    try {
      const r = await fetch('/api/llm/stop-server', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Stop server failed');
      logLine('Stop server: process stopped if this app had started it.');
      setStatus('Stop sent.', '');
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Stop server: ' + e.message);
    }
  });
}

$('btnRefreshChat').addEventListener('click', () => loadChat().catch(() => {}));
$('btnRefreshSouls').addEventListener('click', () => loadDataTab().catch((e) => setStatus(e.message, 'err')));

if ($('btnSaveBotPersona')) {
  $('btnSaveBotPersona').addEventListener('click', async () => {
    setStatus('Saving Bot Personal…', '');
    try {
      const body = {
        llmModel: $('llmModel').value.trim(),
        botPersona: {
          displayName: $('botDisplayName').value.trim(),
          gender: $('botGender') ? $('botGender').value.trim() : '',
          style: $('botStyle').value.trim(),
          role: $('botRole').value.trim(),
          addressUserEn: $('botAddressUserEn').value.trim(),
          addressUserMy: $('botAddressUserMy').value.trim(),
        },
      };
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      logLine('Bot Personal saved.');
      setStatus('Bot Personal saved.', 'ok');
      await loadSettingsIntoForm();
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Bot Personal: ' + e.message);
    }
  });
}

if ($('memSessionSelect')) {
  $('memSessionSelect').addEventListener('change', () => {
    loadSoulForCurrentMemSession().catch((e) => setStatus(e.message, 'err'));
  });
}
if ($('btnMemReload')) {
  $('btnMemReload').addEventListener('click', () =>
    loadDataTab().catch((e) => setStatus(e.message, 'err'))
  );
}
if ($('btnSaveMemSession')) {
  $('btnSaveMemSession').addEventListener('click', async () => {
    const uid = Number($('memSessionSelect')?.value);
    if (!Number.isFinite(uid)) {
      setStatus('Pick a session.', 'err');
      return;
    }
    setStatus('Saving session memory…', '');
    try {
      const payload = {
        display_name: $('memDisplayName').value.trim() || null,
        profile: {
          whoAmI: $('memWhoAmI').value.trim(),
          work: $('memWork').value.trim(),
          gender: $('memGender') ? $('memGender').value.trim() : '',
          age: $('memAge') ? $('memAge').value.trim() : '',
          extra: $('memExtra').value.trim(),
          memorySummary: $('memMemorySummary') ? $('memMemorySummary').value.trim() : '',
        },
      };
      const r = await fetch(`/api/soul/${uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      logLine(`Session memory saved for user ${uid}.`);
      setStatus('Session memory saved.', 'ok');
      await loadSouls();
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Session memory: ' + e.message);
    }
  });
}
if ($('btnClearMemSession')) {
  $('btnClearMemSession').addEventListener('click', async () => {
    const uid = Number($('memSessionSelect')?.value);
    if (!Number.isFinite(uid)) {
      setStatus('Pick a session.', 'err');
      return;
    }
    if (
      !confirm(
        `Clear all memory for user id ${uid}? This cannot be undone.`
      )
    ) {
      return;
    }
    setStatus('Clearing…', '');
    try {
      const r = await fetch(`/api/soul/${uid}/clear`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Clear failed');
      logLine(`Cleared soul for user ${uid}.`);
      setStatus('Memory cleared.', 'ok');
      await loadDataTab();
    } catch (e) {
      setStatus(e.message, 'err');
    }
  });
}
if ($('btnClearAllMemory')) {
  $('btnClearAllMemory').addEventListener('click', async () => {
    const typed = prompt(
      'This deletes ALL souls, ALL chat history, ALL pending actions, and ALL calendar events.\n\nType DELETE ALL to confirm:'
    );
    if (typed !== 'DELETE ALL') {
      if (typed != null) setStatus('Cancelled.', '');
      return;
    }
    setStatus('Clearing all memory…', '');
    try {
      const r = await fetch('/api/memory/clear-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE ALL' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Clear failed');
      logLine('All stored memory cleared (soul, chat_log, pending, events).');
      setStatus('All memory cleared.', 'ok');
      await loadDataTab();
      if ($('panel-chat')?.classList.contains('active')) loadChat().catch(() => {});
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Clear all: ' + e.message);
    }
  });
}

if ($('btnCopyMemSession')) {
  $('btnCopyMemSession').addEventListener('click', async () => {
    const to = Number($('memSessionSelect')?.value);
    const from = Number($('memCopyFromSelect')?.value);
    if (!Number.isFinite(to) || !Number.isFinite(from)) {
      setStatus('Select source and current session.', 'err');
      return;
    }
    if (from === to) {
      setStatus('Pick a different source session.', 'err');
      return;
    }
    if (!confirm(`Copy memory from ${from} into ${to}? Existing data for ${to} will be replaced.`)) return;
    setStatus('Copying…', '');
    try {
      const r = await fetch('/api/soul/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromUserId: from, toUserId: to }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Copy failed');
      logLine(`Copied soul ${from} → ${to}.`);
      setStatus('Memory copied.', 'ok');
      await loadSoulForCurrentMemSession();
      await loadSouls();
    } catch (e) {
      setStatus(e.message, 'err');
    }
  });
}
$('btnRefreshCal').addEventListener('click', () => loadCalendar().catch(() => {}));
$('btnRefreshPending').addEventListener('click', () => loadPending().catch(() => {}));
$('btnRefreshAccess').addEventListener('click', () => loadAccess().catch((e) => setStatus(e.message, 'err')));
$('chatLimit').addEventListener('change', () => loadChat().catch(() => {}));
if ($('chatSessionSelect')) {
  $('chatSessionSelect').addEventListener('change', () => {
    localStorage.setItem(CHAT_SESSION_STORAGE_KEY, $('chatSessionSelect').value);
    loadChat().catch((e) => setStatus(e.message, 'err'));
  });
}
if ($('btnChatSend')) {
  $('btnChatSend').addEventListener('click', () => sendChatFromGui().catch(() => {}));
}
if ($('chatInput')) {
  $('chatInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      sendChatFromGui().catch(() => {});
    }
  });
}
function routeHash() {
  let h = (location.hash || '#overview').slice(1) || 'overview';
  if (h === 'chart') {
    h = 'chat';
    try {
      history.replaceState(null, '', '#chat');
    } catch {
      /* ignore */
    }
  }
  const allowed = [
    'overview',
    'engine',
    'telegram',
    'access',
    'data',
    'chat',
    'calendar',
    'pending',
    'system',
  ];
  showTab(allowed.includes(h) ? h : 'overview');
}

window.addEventListener('hashchange', routeHash);

(async function init() {
  try {
    await loadSettingsIntoForm();
    if (!location.hash) location.hash = '#overview';
    routeHash();
    setInterval(async () => {
      try {
        if (!document.getElementById('panel-overview')?.classList.contains('active')) return;
        await loadOverview();
      } catch {
        /* ignore */
      }
    }, 5000);
    let _hwChartResizeT;
    window.addEventListener(
      'resize',
      () => {
        clearTimeout(_hwChartResizeT);
        _hwChartResizeT = setTimeout(() => {
          if (document.getElementById('panel-overview')?.classList.contains('active')) {
            redrawHardwareCharts();
          }
        }, 120);
      },
      { passive: true }
    );
    setInterval(() => {
      if (document.getElementById('panel-chat')?.classList.contains('active')) {
        loadChat().catch(() => {});
      }
      if (document.getElementById('panel-access')?.classList.contains('active')) {
        loadAccess().catch(() => {});
      }
    }, 8000);
  } catch (e) {
    setStatus(e.message, 'err');
  }
})();
