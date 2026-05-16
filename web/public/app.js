const $ = (id) => document.getElementById(id);

/** Same-origin API calls always send the session cookie (required if API host differs later). */
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, credentials: opts.credentials ?? 'include' });
}
const NEURAL_BG_STORAGE_KEY = 'guiNeuralBackgroundEnabled';
let neuralBackgroundEnabled = true;

/** Last `/api/settings` JSON — used to merge global bot persona with per-session overrides in Memory. */
let lastSettingsForGui = null;

/** Avoid reacting to programmatic updates on the Telegram bot power checkbox (if a browser fires `change`). */
let botPowerSwitchSyncing = false;

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

const MEMORY_SUBTAB_KEY = 'guiMemorySubtab';
const MEMORY_BOT_KEY = 'guiMemoryBotId';
let currentMemoryBotId = null;

function setMemorySubtab(which) {
  const allowed = new Set(['bot', 'session', 'souls']);
  const w = allowed.has(which) ? which : 'bot';
  try {
    localStorage.setItem(MEMORY_SUBTAB_KEY, w);
  } catch {
    /* ignore */
  }
  document.querySelectorAll('.mem-stab-link').forEach((btn) => {
    const on = btn.dataset.memSub === w;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.mem-subpane').forEach((pane) => {
    if (pane.dataset.memSub === w) pane.removeAttribute('hidden');
    else pane.setAttribute('hidden', '');
  });
}

function setStatus(msg, kind) {
  const el = $('status');
  const text = String(msg || '').trim();
  if (text) {
    const level = kind === 'err' ? 'error' : 'info';
    logLine(`[${level}] ${text}`);
  }
  if (kind !== 'err') {
    el.textContent = '';
    el.className = 'statusbar';
    return;
  }
  el.textContent = msg || '';
  el.className = 'statusbar ' + (kind || '');
}

function showToast(message, kind = 'info') {
  const host = $('toastHost');
  const text = String(message || '').trim();
  if (!host || !text) return;
  const el = document.createElement('div');
  const tone = kind === 'err' || kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : 'info';
  el.className = `toast toast--${tone}`;
  el.textContent = text;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 320);
  }, 4500);
}

function syncEnginePathReadouts() {
  const g = $('ggufPath')?.value?.trim() || '';
  const m = $('mmprojPath')?.value?.trim() || '';
  const dg = $('displayMainModelPath');
  if (dg) {
    dg.value = g;
    dg.title = g || dg.placeholder;
  }
  const dm = $('displayMmprojPath');
  if (dm) {
    dm.value = m;
    dm.title = m || dm.placeholder;
  }
}

function parseLlamaBindFromForm() {
  const raw = String($('llamaServerUrl')?.value || 'http://127.0.0.1:8080').trim();
  try {
    const u = new URL(raw.replace(/\/$/, ''));
    const host = u.hostname || '127.0.0.1';
    const port = Number(u.port || 8080);
    return { host, port: Number.isFinite(port) && port > 0 ? port : 8080 };
  } catch {
    return { host: '127.0.0.1', port: 8080 };
  }
}

function logLine(line) {
  const el = $('log');
  const t = new Date().toLocaleTimeString();
  if (!el) return;
  el.textContent = `[${t}] ${line}`;
}

/** End session and redirect (admin → admin-login, user → /login). */
async function logoutAndRedirect(redirectTo = '/admin-login') {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* still redirect */
  }
  location.href = redirectTo;
}

function initWindowControls() {
  const controls = window.senaWindowControls;
  if (!controls) return;
  $('winMinimize')?.addEventListener('click', () => controls.minimize());
  $('winMaximize')?.addEventListener('click', () => controls.toggleMaximize());
  $('winClose')?.addEventListener('click', () => controls.close());
}

function canResolveNativeFilePath() {
  return Boolean(window.senaNativeFile?.getLocalPathFromFile);
}

/**
 * File picker with optional native path (when available), then browser file input fallback.
 * @param {Array<() => Promise<string|null|undefined>>} ipcPickers
 */
async function pickLocalGgufFilesystemPath(ipcPickers = []) {
  const list = Array.isArray(ipcPickers) ? ipcPickers : [];
  for (const fn of list) {
    if (typeof fn !== 'function') continue;
    try {
      const p = String((await fn()) || '').trim();
      if (p) return { fullPath: p, fileName: basenamePath(p) };
    } catch {
      /* try next picker */
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gguf,application/octet-stream';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) {
        resolve({ fullPath: '', fileName: '' });
        return;
      }
      let p = '';
      try {
        if (canResolveNativeFilePath()) {
          p = String(window.senaNativeFile.getLocalPathFromFile(f) || '').trim();
        } else if (typeof f.path === 'string' && f.path) {
          p = f.path.trim();
        }
      } catch {
        p = '';
      }
      resolve({
        fullPath: p,
        fileName: String(f.name || '').trim(),
      });
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** File picker for .mmproj / mmproj .gguf vision projector files. */
async function pickLocalMmprojFilesystemPath(ipcPickers = []) {
  const list = Array.isArray(ipcPickers) ? ipcPickers : [];
  for (const fn of list) {
    if (typeof fn !== 'function') continue;
    try {
      const p = String((await fn()) || '').trim();
      if (p) return { fullPath: p, fileName: basenamePath(p) };
    } catch {
      /* try next picker */
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mmproj,.gguf,application/octet-stream';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) {
        resolve({ fullPath: '', fileName: '' });
        return;
      }
      let p = '';
      try {
        if (canResolveNativeFilePath()) {
          p = String(window.senaNativeFile.getLocalPathFromFile(f) || '').trim();
        } else if (typeof f.path === 'string' && f.path) {
          p = f.path.trim();
        }
      } catch {
        p = '';
      }
      resolve({
        fullPath: p,
        fileName: String(f.name || '').trim(),
      });
    });
    document.body.appendChild(input);
    input.click();
  });
}

function parseGgufModelIdFromPath(filePath) {
  const name = String(filePath || '')
    .split(/[\\/]/)
    .pop();
  if (!name) return '';
  return name.replace(/\.gguf$/i, '').trim();
}

function updateSelectedGgufLabel(modelId) {
  const el = $('selectedGgufLabel');
  if (!el) return;
  const full = $('ggufPath')?.value?.trim() || '';
  if (full) {
    el.textContent = full;
    return;
  }
  const id = String(modelId || '').trim();
  el.textContent = id ? `${id}.gguf` : 'No local model file selected yet.';
}

function ensureModelOptionSelected(modelId) {
  const sel = $('llmModel');
  const id = String(modelId || '').trim();
  if (!sel || !id) return;
  let has = false;
  for (const opt of sel.options) {
    if (String(opt.value || '').trim() === id) {
      has = true;
      break;
    }
  }
  if (!has) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${id} (.gguf)`;
    sel.appendChild(opt);
  }
  sel.value = id;
}

function getModelIdFromGgufLabel() {
  const label = $('selectedGgufLabel');
  const raw = String(label?.textContent || '').trim();
  if (!raw || raw === 'No local model file selected yet.') return '';
  return raw.replace(/\.gguf$/i, '').trim();
}

function basenamePath(p) {
  return String(p || '')
    .trim()
    .split(/[/\\]/)
    .pop();
}

function joinFolderAndFile(folder, fileName) {
  const dir = String(folder || '').trim();
  const name = String(fileName || '').trim();
  if (!dir || !name) return '';
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function normalizeModelsDirInput(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/\.gguf$/i.test(v)) {
    return v.replace(/[\\/][^\\/]+$/, '');
  }
  return v;
}

/** Directory containing the selected .gguf (avoids leaving modelsDir on default `models` → app Support folder). */
function deriveModelsDirFromGgufPath(ggufPath) {
  const p = String(ggufPath || '').trim();
  if (!p || !/\.gguf$/i.test(p)) return '';
  if (!p.includes('/') && !p.includes('\\')) return '';
  return normalizeModelsDirInput(p);
}

/** Folder to save as modelsDir: parent of active GGUF when set, otherwise the hidden models field. */
function effectiveModelsDirForSave() {
  const fromGguf = deriveModelsDirFromGgufPath($('ggufPath')?.value?.trim() || '');
  if (fromGguf) return fromGguf;
  return normalizeModelsDirInput($('modelsDir')?.value?.trim() || '');
}

function updateSelectedMmprojLabel() {
  const el = $('selectedMmprojLabel');
  if (!el) return;
  const full = $('mmprojPath')?.value?.trim() || '';
  el.textContent = full || 'None — add an mmproj .gguf for multimodal (images).';
}

let lastConsoleStatusSignature = '';
let lastGuiConsoleUserId = 900000001;
const OVERVIEW_CHAT_LIMIT = '50';
let chatSendInFlight = false;
const MAX_CHAT_IMAGE_BYTES = 6 * 1024 * 1024;
const pendingChatImageByPane = {
  overview: null,
  chat: null,
};

async function refreshConsoleStatusLine() {
  try {
    const [botRes, llmRes, settingsRes] = await Promise.all([
      apiFetch('/api/bot/status'),
      apiFetch('/api/llm/server-status'),
      apiFetch('/api/settings'),
    ]);
    const bot = await botRes.json();
    const llm = await llmRes.json();
    const settings = await settingsRes.json();
    if (!botRes.ok || !llmRes.ok || !settingsRes.ok) return;

    const botState = bot.running ? 'running' : bot.starting ? 'starting' : 'stopped';
    const llmState = llm.online ? 'online' : 'offline';
    const provider = String(settings.llmProvider || 'unknown');
    const model = String(settings.llmModel || '—').trim() || '—';
    const sig = `${botState}|${llmState}|${provider}|${model}`;
    if (sig === lastConsoleStatusSignature) return;
    lastConsoleStatusSignature = sig;
    logLine(`Status: bot ${botState} | LLM ${llmState} | backend ${provider} | model ${model}`);
  } catch {
    /* ignore status refresh errors */
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initNeuralBackground() {
  const canvas = $('network');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let nodes = [];
  const NODE_COUNT = 128;
  const MAX_DISTANCE = 170;
  const MOUSE_LINK_DISTANCE = 240;
  let tick = 0;
  const mouse = { x: -9999, y: -9999, active: false };

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function resetNodes() {
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 2 + 1,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function drawLink(x1, y1, x2, y2, strength) {
    ctx.strokeStyle = `rgba(120,150,255,${strength * 0.42})`;
    ctx.lineWidth = 0.8 + strength * 1.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function animate() {
    if (!neuralBackgroundEnabled) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(animate);
      return;
    }
    tick += 0.018;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DISTANCE) {
          const opacity = 1 - dist / MAX_DISTANCE;
          drawLink(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y, opacity);
        }
      }
    }

    for (const node of nodes) {
      if (mouse.active) {
        const mdx = node.x - mouse.x;
        const mdy = node.y - mouse.y;
        const md = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < MOUSE_LINK_DISTANCE) {
          drawLink(node.x, node.y, mouse.x, mouse.y, 1 - md / MOUSE_LINK_DISTANCE);
        }
      }

      const pulse = 0.65 + 0.35 * Math.sin(tick + node.phase);
      const r = node.radius * (0.9 + pulse * 0.35);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(190,210,255,${0.72 + pulse * 0.24})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 4.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120,150,255,${0.04 + pulse * 0.05})`;
      ctx.fill();

      node.x += node.vx;
      node.y += node.vy;

      if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
      if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
    }

    requestAnimationFrame(animate);
  }

  resizeCanvas();
  resetNodes();
  animate();
  window.addEventListener('pointermove', (ev) => {
    mouse.x = ev.clientX;
    mouse.y = ev.clientY;
    mouse.active = true;
  });
  window.addEventListener('pointerleave', () => {
    mouse.active = false;
  });
  window.addEventListener('resize', () => {
    resizeCanvas();
    resetNodes();
  });
}

function applyNeuralBackgroundUi(enabled) {
  neuralBackgroundEnabled = Boolean(enabled);
  document.body.classList.toggle('neural-bg-off', !neuralBackgroundEnabled);
  document.querySelectorAll('.neural-bg-toggle').forEach((input) => {
    input.checked = neuralBackgroundEnabled;
  });
}

function initNeuralBackgroundToggle() {
  const saved = localStorage.getItem(NEURAL_BG_STORAGE_KEY);
  const enabled = saved == null ? true : saved === '1';
  applyNeuralBackgroundUi(enabled);
  document.querySelectorAll('.neural-bg-toggle').forEach((input) => {
    input.addEventListener('change', () => {
      applyNeuralBackgroundUi(Boolean(input.checked));
      localStorage.setItem(NEURAL_BG_STORAGE_KEY, neuralBackgroundEnabled ? '1' : '0');
    });
  });
}

function updateScrollIndicatorScrollable() {
  const scroller = document.querySelector('.main');
  const indicator = $('scrollIndicator');
  if (!scroller || !indicator) return;
  const canScroll = scroller.scrollHeight > scroller.clientHeight + 2;
  indicator.classList.toggle('is-scrollable', canScroll);
  scroller.classList.toggle('has-scroll-indicator', canScroll);
  if (!canScroll) indicator.classList.remove('up', 'down');
}

function initScrollbarArrowGlow() {
  const scroller = document.querySelector('.main');
  const indicator = $('scrollIndicator');
  if (!scroller || !indicator) return;

  let prevTop = scroller.scrollTop;
  let clearTimer = null;
  let resizeTimer = null;

  scroller.addEventListener(
    'scroll',
    () => {
      if (!indicator.classList.contains('is-scrollable')) return;
      const currentTop = scroller.scrollTop;
      const dir = currentTop > prevTop ? 'down' : currentTop < prevTop ? 'up' : '';
      prevTop = currentTop;
      if (!dir) return;
      indicator.classList.remove('up', 'down');
      /* Restart CSS animation wave (sequential glow) */
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          indicator.classList.add(dir);
        });
      });
      if (clearTimer) clearTimeout(clearTimer);
      /* Last delay 0.405s + one arrow duration ~0.48s */
      clearTimer = setTimeout(() => {
        indicator.classList.remove('up', 'down');
      }, 1000);
    },
    { passive: true }
  );

  const scheduleMeasure = () => {
    window.requestAnimationFrame(() => updateScrollIndicatorScrollable());
  };

  window.addEventListener(
    'resize',
    () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(scheduleMeasure, 80);
    },
    { passive: true }
  );

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => scheduleMeasure());
    ro.observe(scroller);
    document.querySelectorAll('.tab-panel').forEach((panel) => ro.observe(panel));
  }

  scheduleMeasure();
}

function initCustomCursor() {
  const cursor = document.querySelector('.cursor');
  const ring = document.querySelector('.cursor-ring');
  if (!cursor || !ring) return;
  if (!window.matchMedia('(pointer: fine)').matches) return;

  document.body.classList.add('custom-cursor-active');

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let ringX = mouseX;
  let ringY = mouseY;
  let visible = false;
  let hovering = false;
  let pressed = false;
  let textMode = false;
  let targetMode = false;
  let targetEl = null;
  let ringW = 35;
  let ringH = 35;

  const textSelector =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, [contenteditable="true"]';
  const sideMenuSelector =
    '#mainNav .nav-item, #mainNav .nav-settings-toggle, #lblBotPower, .bot-power-switch, .neo-toggle, .neo-toggle-container';

  function setVisible(on) {
    visible = on;
    cursor.style.opacity = on ? '1' : '0';
    ring.style.opacity = on ? '1' : '0';
  }

  function applyRingVisual() {
    cursor.classList.toggle('cursor-text-mode', textMode);
    if (textMode) {
      ring.style.opacity = '0';
      ring.style.transform = 'translate(-50%, -50%) scale(0.4)';
      ring.style.borderColor = 'rgba(120,150,255,0.6)';
      return;
    }
    ring.style.opacity = visible ? '1' : '0';
    ring.classList.toggle('cursor-ring-target', targetMode);
    let scale = 1;
    if (!targetMode) scale = hovering ? 1.8 : 1;
    if (pressed) scale *= 0.92;
    ring.style.transform = `translate(-50%, -50%) scale(${scale})`;
    if (targetMode) {
      ring.style.borderColor = 'rgba(120,170,255,0.9)';
    } else {
      ring.style.borderColor = hovering ? 'rgba(236,72,153,0.8)' : 'rgba(120,150,255,0.6)';
    }
  }

  function setHover(on) {
    hovering = on;
    applyRingVisual();
  }

  function setTarget(el) {
    targetEl = el || null;
    targetMode = Boolean(targetEl);
    applyRingVisual();
  }

  document.addEventListener('pointermove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cursor.style.left = `${mouseX}px`;
    cursor.style.top = `${mouseY}px`;
    if (!visible) setVisible(true);
  });

  document.addEventListener('pointerleave', () => setVisible(false));
  document.addEventListener('pointerenter', () => setVisible(true));

  document.addEventListener('pointerover', (e) => {
    textMode = Boolean(e.target.closest(textSelector));
    setTarget(e.target.closest(sideMenuSelector));
    const hit = e.target.closest('button, a, .clickable, [role="button"], input, select, textarea, label');
    setHover(Boolean(hit));
  });

  document.addEventListener('pointerdown', () => {
    pressed = true;
    applyRingVisual();
  });
  document.addEventListener('pointerup', () => {
    pressed = false;
    const elAtPoint = document.elementFromPoint(mouseX, mouseY);
    const hit = elAtPoint?.closest(
      'button, a, .clickable, [role="button"], input, select, textarea, label'
    );
    textMode = Boolean(elAtPoint?.closest(textSelector));
    setTarget(elAtPoint?.closest(sideMenuSelector));
    setHover(Boolean(hit));
  });

  function animate() {
    let tx = mouseX;
    let ty = mouseY;
    let tw = 35;
    let th = 35;
    if (targetMode && targetEl?.isConnected) {
      const rect = targetEl.getBoundingClientRect();
      tx = rect.left + rect.width / 2;
      ty = rect.top + rect.height / 2;
      tw = Math.max(42, rect.width + 12);
      th = Math.max(28, rect.height + 8);
    } else if (targetMode) {
      setTarget(null);
    }

    const follow = targetMode ? 0.32 : 0.28;
    ringX += (tx - ringX) * follow;
    ringY += (ty - ringY) * follow;
    ringW += (tw - ringW) * follow;
    ringH += (th - ringH) * follow;
    ring.style.left = `${ringX}px`;
    ring.style.top = `${ringY}px`;
    ring.style.width = `${ringW}px`;
    ring.style.height = `${ringH}px`;
    requestAnimationFrame(animate);
  }
  animate();
}

/**
 * SQLite / legacy API values are often UTC as "YYYY-MM-DD HH:MM:SS" or "…T…" without Z.
 * ECMAScript parses those as *local* wall time, so the Control Panel lags Telegram by your
 * UTC offset. Treat bare SQL-like strings as UTC (same rule as server sqliteUtcStringToIsoZ).
 */
function parseUtcTimestampForDisplay(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t) && (/[zZ]|[+-]\d{2}:?\d{2}/.test(t))) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const bare = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d{1,9}))?/);
  if (bare) {
    const frac = bare[3] ? `.${String(bare[3]).padEnd(3, '0').slice(0, 3)}` : '';
    const d = new Date(`${bare[1]}T${bare[2]}${frac}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatChatTimestampLocal(s) {
  const d = parseUtcTimestampForDisplay(s);
  return d ? d.toLocaleString() : '';
}

function isLlamaRemoteModeFromForm() {
  const sel = $('llamaServerMode');
  if (sel) return String(sel.value || 'local').trim() === 'remote';
  const s = lastSettingsForGui || {};
  if (s.llamaServerMode === 'remote' || s.llamaServerRemote) return true;
  if (s.llamaServerExternal === true) return true;
  return false;
}

function syncLlamaModelPickersFromHidden() {
  const main = $('llmModel');
  const remote = $('llmModelRemote');
  if (!main || !remote) return;
  if (isLlamaRemoteModeFromForm()) {
    remote.value = main.value || remote.value;
  } else {
    main.value = remote.value || main.value;
  }
}

function syncHiddenModelFromLlamaUi() {
  const main = $('llmModel');
  const remote = $('llmModelRemote');
  if (!main || !remote) return;
  if (isLlamaRemoteModeFromForm()) {
    if (remote.value) main.value = remote.value;
  } else if (main.value) {
    remote.value = main.value;
  }
}

async function populateRemoteModelSelect(selected, opts = {}) {
  const sel = $('llmModelRemote');
  const hint = $('llamaRemoteModelsHint');
  if (!sel) return false;
  try {
    const r = await apiFetch('/api/llm/catalog' + catalogQueryForUiBackend());
    const c = await r.json();
    if (!r.ok) throw new Error(c.error || c.remoteError || 'Could not list remote models');
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Select model on server';
    sel.appendChild(ph);
    const remoteOnly = (c.options || []).filter((o) => o.source === 'remote');
    const list = remoteOnly.length ? remoteOnly : c.options || [];
    for (const opt of list) {
      const id = String(opt.id || '').trim();
      if (!id) continue;
      const o = document.createElement('option');
      o.value = id;
      o.textContent = opt.label || id;
      sel.appendChild(o);
    }
    const want = String(selected || $('llmModel')?.value || '').trim();
    if (want && [...sel.options].some((x) => x.value === want)) sel.value = want;
    else if (want) {
      const o = document.createElement('option');
      o.value = want;
      o.textContent = `${want} (custom)`;
      sel.appendChild(o);
      sel.value = want;
    }
    if (hint) {
      hint.textContent = c.remoteOk
        ? `${list.length} model(s) from ${c.llamaServerUrl || 'server'}.`
        : c.remoteError || 'Server reachable but model list empty — type a model id in catalog or pick from list after Refresh.';
    }
    syncHiddenModelFromLlamaUi();
    return true;
  } catch (e) {
    if (hint) hint.textContent = e.message || String(e);
    return false;
  }
}

function updateProviderVisibility() {
  const p = $('llmProvider').value;
  const llamaRemote = p === 'llama-server' && isLlamaRemoteModeFromForm();
  $('wrapOllama').classList.toggle('hidden', p !== 'ollama');
  $('wrapLlama').classList.toggle('hidden', p !== 'llama-server');
  $('wrapOpenAi')?.classList.toggle('hidden', p !== 'openai');
  $('wrapOpenRouter')?.classList.toggle('hidden', p !== 'openrouter');
  $('wrapGemini')?.classList.toggle('hidden', p !== 'gemini');
  $('wrapLlamaLocalModels')?.classList.toggle('hidden', p !== 'llama-server' || llamaRemote);
  $('wrapLlamaRemoteAuth')?.classList.toggle('hidden', !llamaRemote);
  $('wrapLlamaRemoteModels')?.classList.toggle('hidden', !llamaRemote);
  $('localLlmActions')?.classList.toggle('hidden', !isLocalLlmProvider(p));
  $('btnStartEmbeddedServer')?.classList.toggle('hidden', p !== 'llama-server' || llamaRemote);
  const hint = $('localLlmTestHint');
  if (hint) {
    hint.classList.toggle('hidden', !isLocalLlmProvider(p));
    if (isLocalLlmProvider(p)) {
      hint.textContent = llamaRemote
        ? 'Test the remote llama.cpp URL (and API key if set) before saving.'
        : 'For local backends, test the current base URL before saving.';
    }
  }
  applyEmbeddedStartDisabledState();
  refreshEmbeddedServerButtonState().catch(() => {});
  if (llamaRemote) populateRemoteModelSelect().catch(() => {});
}

const CHAT_SESSION_STORAGE_KEY = 'guiChatSessionUserId';
/** Pixels from bottom: if user is within this, treat as "following" the thread (auto-refresh scrolls down). */
const CHAT_STICK_BOTTOM_THRESHOLD_PX = 120;
let lastChatLoadedUserId = null;
let lastChatMessages = [];

let syncingWebSearchInputs = false;
let webSearchSaving = false;
let embeddedServerRunning = false;
let embeddedStartInFlight = false;

function setEmbeddedServerButtonRunning(running) {
  embeddedServerRunning = Boolean(running);
  const btn = $('btnStartEmbeddedServer');
  if (!btn) return;
  btn.textContent = embeddedServerRunning ? 'Stop Embedded Server' : 'Start Embedded Server';
  btn.classList.toggle('danger', embeddedServerRunning);
  btn.classList.toggle('primary', !embeddedServerRunning);
  applyEmbeddedStartDisabledState();
}

function updateEngineEmbeddedStatusFromJson(j) {
  const badge = $('embeddedServerStatusBadge');
  const detail = $('embeddedServerStatusDetail');
  const prov = String($('llmProvider')?.value || '').trim().toLowerCase();
  if (!badge) return;
  if (prov !== 'llama-server') {
    badge.textContent = '—';
    badge.className = 'embedded-status-badge embedded-status--neutral';
    if (detail) detail.textContent = '';
    return;
  }
  if (isLlamaRemoteModeFromForm()) {
    const url = String($('llamaServerUrl')?.value || '').trim();
    const listening = Boolean(j?.listening);
    badge.textContent = listening ? 'Remote online' : 'Remote offline';
    badge.className = listening
      ? 'embedded-status-badge embedded-status--running'
      : 'embedded-status-badge embedded-status--offline';
    if (detail) {
      detail.textContent = listening
        ? `Using online server at ${url}`
        : `Cannot reach ${url}. Test connection or check API key.`;
    }
    return;
  }
  if (embeddedStartInFlight) {
    badge.textContent = 'Starting…';
    badge.className = 'embedded-status-badge embedded-status--starting';
    if (detail) detail.textContent = 'Launching llama-server with your selected files.';
    return;
  }
  const panel = j.embeddedPanel || {};
  const running = Boolean(j.embeddedRunning);
  const listening = Boolean(j.listening);
  const lastErr = String(panel.lastError || '').trim();

  if (running && listening) {
    const p = panel.port || String(parseLlamaBindFromForm().port);
    badge.textContent = `Running on port ${p}`;
    badge.className = 'embedded-status-badge embedded-status--running';
    if (detail) detail.textContent = '';
  } else if (running && !listening) {
    badge.textContent = 'Starting…';
    badge.className = 'embedded-status-badge embedded-status--starting';
    if (detail) detail.textContent = 'Process is running; waiting for the HTTP API to respond.';
  } else if (lastErr) {
    badge.textContent = 'Error';
    badge.className = 'embedded-status-badge embedded-status--error';
    if (detail) detail.textContent = lastErr.length > 280 ? `${lastErr.slice(0, 280)}…` : lastErr;
  } else {
    badge.textContent = 'Offline';
    badge.className = 'embedded-status-badge embedded-status--offline';
    if (detail) detail.textContent = '';
  }
}

function applyEmbeddedStartDisabledState() {
  const btn = $('btnStartEmbeddedServer');
  if (!btn) return;
  const prov = String($('llmProvider')?.value || '').trim().toLowerCase();
  if (prov !== 'llama-server' || isLlamaRemoteModeFromForm()) {
    btn.disabled = false;
    return;
  }
  if (embeddedStartInFlight) {
    btn.disabled = true;
    return;
  }
  const gguf = $('ggufPath')?.value?.trim() || '';
  if (embeddedServerRunning) {
    btn.disabled = false;
    return;
  }
  btn.disabled = !gguf;
}

async function refreshEmbeddedServerButtonState() {
  const provider = String($('llmProvider')?.value || '').trim().toLowerCase();
  if (!isLocalLlmProvider(provider)) {
    setEmbeddedServerButtonRunning(false);
    updateEngineEmbeddedStatusFromJson({});
    return;
  }
  if (provider === 'ollama') {
    setEmbeddedServerButtonRunning(false);
    updateEngineEmbeddedStatusFromJson({});
    return;
  }
  try {
    const r = await apiFetch('/api/llm/server-status');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Status failed');
    setEmbeddedServerButtonRunning(Boolean(j.embeddedRunning));
    updateEngineEmbeddedStatusFromJson(j);
  } catch {
    setEmbeddedServerButtonRunning(false);
    updateEngineEmbeddedStatusFromJson({});
  }
  applyEmbeddedStartDisabledState();
}

function webSearchToggleInputs() {
  return [$('webSearchEnabled'), $('overviewWebSearch')].filter(Boolean);
}

function setWebSearchInputsChecked(checked) {
  syncingWebSearchInputs = true;
  for (const el of webSearchToggleInputs()) {
    el.checked = Boolean(checked);
  }
  syncingWebSearchInputs = false;
}

async function persistWebSearchSetting(checked) {
  if (webSearchSaving) return;
  webSearchSaving = true;
  setStatus('Saving web search…', '');
  try {
    const r = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webSearchEnabled: checked }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    const st = j.settings || {};
    setWebSearchInputsChecked(Boolean(st.webSearchEnabled));
    setStatus('Web search saved.', 'ok');
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Web search save: ' + e.message);
    await loadSettingsIntoForm();
  } finally {
    webSearchSaving = false;
  }
}

/** Masked preview for empty token field when a token is already saved (last 4 from API). */
function telegramSavedTokenPlaceholder(maskedFromApi) {
  const masked = String(maskedFromApi || '').replace(/\s/g, '');
  const last4 = masked.slice(-4) || '????';
  return `xxxxxxxxxxxx-xxxx-${last4}`;
}

function renderTelegramTokenList(maskedTokens, identityByIndex = {}) {
  const el = $('telegramTokenList');
  if (!el) return;
  const list = Array.isArray(maskedTokens) ? maskedTokens.filter(Boolean) : [];
  if (!list.length) {
    el.innerHTML = '<span class="hint">No bot tokens connected yet.</span>';
    return;
  }
  el.innerHTML = list
    .map((tok, idx) => {
      const identity = identityByIndex && typeof identityByIndex === 'object' ? identityByIndex[idx] : null;
      const botName = identity ? ` (@${String(identity)})` : '';
      return `<span class="telegram-token-chip"><span class="telegram-token-chip-label">Bot ${
        idx + 1
      }${escapeHtml(botName)}: ${escapeHtml(String(tok))}</span><button type="button" class="btn-mini danger telegram-token-remove" data-telegram-token-remove="${idx}" aria-label="Remove Bot ${
        idx + 1
      } token">Remove</button></span>`;
    })
    .join('');
}

async function fetchTelegramBotIdentityByIndex() {
  const r = await apiFetch('/api/telegram/bot-identities');
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Failed to load Telegram bot usernames');
  const bots = Array.isArray(j.bots) ? j.bots : [];
  const out = {};
  for (const b of bots) {
    const idx = Number(b?.index);
    if (!Number.isInteger(idx) || idx < 0) continue;
    const username = String(b?.username || '').trim().replace(/^@+/, '');
    if (username) out[idx] = username;
  }
  return out;
}

/** Replacing a stored Telegram token requires two separate OK confirmations. */
function confirmReplaceSavedTelegramToken() {
  if (!lastSettingsForGui?.hasSavedToken) return true;
  const ok1 = window.confirm(
    'Telegram bot token(s) are already saved on this machine.\n\n' +
      'Do you want to add this new token to the connected bot list?'
  );
  if (!ok1) return false;
  const ok2 = window.confirm(
    'Second confirmation: this new token will be added and kept in settings.\n\n' +
      'Choose OK only if this token belongs to your Telegram bot.'
  );
  return ok2;
}

function wireWebSearchToggles() {
  for (const el of webSearchToggleInputs()) {
    el?.addEventListener('change', () => {
      if (syncingWebSearchInputs) return;
      const on = el.checked;
      for (const x of webSearchToggleInputs()) {
        if (x !== el) x.checked = on;
      }
      persistWebSearchSetting(on).catch(() => {});
    });
  }
}

async function loadSettingsIntoForm() {
  const r = await apiFetch('/api/settings');
  if (!r.ok) throw new Error('Failed to load settings');
  const s = await r.json();
  lastSettingsForGui = s;

  $('projectRoot').textContent = s.projectRoot || '';

  const tokInp = $('telegramBotToken');
  if (tokInp) {
    tokInp.value = '';
    if (s.hasSavedToken && s.telegramBotTokenMasked) {
      tokInp.placeholder = telegramSavedTokenPlaceholder(s.telegramBotTokenMasked);
    } else {
      tokInp.placeholder = '';
    }
  }
  let botIdentityByIndex = {};
  if (Array.isArray(s.telegramBotTokensMasked) && s.telegramBotTokensMasked.length) {
    try {
      botIdentityByIndex = await fetchTelegramBotIdentityByIndex();
    } catch {
      botIdentityByIndex = {};
    }
  }
  renderTelegramTokenList(s.telegramBotTokensMasked, botIdentityByIndex);
  $('ollamaBaseUrl').value = s.ollamaBaseUrl || 'http://127.0.0.1:11434';
  $('llamaServerUrl').value = s.llamaServerUrl || 'http://127.0.0.1:8080';
  if ($('llamaServerMode')) {
    const remoteMode =
      s.llamaServerMode === 'remote' || Boolean(s.llamaServerRemote) || s.llamaServerExternal === true;
    $('llamaServerMode').value = remoteMode ? 'remote' : 'local';
  }
  if ($('llamaServerApiKey')) $('llamaServerApiKey').value = '';
  const llamaKeyHint = $('llamaServerApiKeyHint');
  if (llamaKeyHint) {
    if (s.hasLlamaServerApiKey && s.llamaServerApiKeyMasked) {
      llamaKeyHint.textContent = `Key active (ends ${s.llamaServerApiKeyMasked.slice(-4)}) — paste to replace.`;
    } else {
      llamaKeyHint.textContent = 'Optional Bearer token for authenticated remote hosts.';
    }
  }
  const prov = String(s.llmProvider || '').toLowerCase();
  const allowed = ['ollama', 'llama-server', 'openai', 'openrouter', 'gemini'];
  $('llmProvider').value = allowed.includes(prov) ? prov : 'llama-server';
  updateProviderVisibility();

  if ($('openaiApiKey')) $('openaiApiKey').value = '';
  if ($('openrouterApiKey')) $('openrouterApiKey').value = '';
  if ($('openrouterBaseUrl')) {
    $('openrouterBaseUrl').value = s.openrouterBaseUrl || 'https://openrouter.ai/api/v1';
  }
  if ($('geminiApiKey')) $('geminiApiKey').value = '';
  const oHint = $('openaiKeyHint');
  if (oHint) {
    if (s.hasOpenAiKey && s.openaiApiKeyMasked) {
      oHint.textContent = `Key active (ends ${s.openaiApiKeyMasked.slice(-4)}) — paste to replace.`;
    } else {
      oHint.textContent = 'Create a key at platform.openai.com → API keys.';
    }
  }
  const orHint = $('openrouterKeyHint');
  if (orHint) {
    if (s.hasOpenRouterKey && s.openrouterApiKeyMasked) {
      orHint.textContent = `Key active (ends ${s.openrouterApiKeyMasked.slice(-4)}) — paste to replace.`;
    } else {
      orHint.textContent = 'Create a key at openrouter.ai/keys.';
    }
  }
  const gHint = $('geminiKeyHint');
  if (gHint) {
    if (s.hasGeminiKey && s.geminiApiKeyMasked) {
      gHint.textContent = `Key active (ends ${s.geminiApiKeyMasked.slice(-4)}) — paste to replace.`;
    } else {
      gHint.textContent = 'Create a key in Google AI Studio (link above).';
    }
  }

  $('guiPort').value = s.guiPort || 3847;
  $('logLevel').value = s.logLevel || 'info';
  $('browserTimeoutMs').value = s.browserTimeoutMs ?? 10000;
  $('maxBrowsePages').value = s.maxBrowsePages ?? 2;
  const ggufEl = $('ggufPath');
  if (ggufEl) {
    const resolvedGguf = String(s.ggufPath || '').trim();
    const rawGguf = String(s.ggufPathInput || '').trim();
    ggufEl.value = resolvedGguf || rawGguf;
  }
  const mdEl = $('modelsDir');
  if (mdEl) {
    const g = ggufEl?.value?.trim() || '';
    const fromGguf = deriveModelsDirFromGgufPath(g);
    mdEl.value = fromGguf || (s.modelsDirInput || '');
  }
  const mmEl = $('mmprojPath');
  if (mmEl) {
    const resolvedMm = String(s.mmprojPath || '').trim();
    const rawMm = String(s.mmprojPathInput || '').trim();
    mmEl.value = resolvedMm || rawMm;
  }
  $('databaseUrl').value = s.databaseUrl || '';
  $('databaseUrlResolved').textContent = s.databaseUrlResolved || '';
  $('openBrowserGui').checked = Boolean(s.openBrowserGui);
  setWebSearchInputsChecked(Boolean(s.webSearchEnabled));
  $('settingsPath').textContent = s.settingsPath || '';
  syncEnginePathReadouts();
  updateSelectedGgufLabel(s.llmModel);
  updateSelectedMmprojLabel();

  const hint = $('tokenHint');
  if (s.hasSavedToken) {
    if (hint)
      hint.textContent =
        `Connected bots: ${Number(s.telegramBotCount || 0)}. Add another token with the check button (requires 2 confirmations).`;
  } else {
    if (hint) hint.textContent = 'Paste token from @BotFather, then click the check to add the first bot.';
  }

  await refreshModelDropdown(String(s.llmModel || '').trim(), { resetSelection: false });
  if (isLlamaRemoteModeFromForm()) {
    await populateRemoteModelSelect(String(s.llmModel || '').trim());
  }

  const onMemory = $('panel-data')?.classList.contains('active');
  if (onMemory && $('memSessionSelect')) {
    loadSoulForCurrentMemSession().catch(() => {});
  } else {
    applyBotPersonaFieldsToForm(s.botPersona || {});
    applyMemAddressFieldsFromSettings(s.botPersona || {});
  }
}

function catalogQueryForUiBackend() {
  const p = $('llmProvider')?.value?.trim();
  if (!p) return '';
  const params = new URLSearchParams({ llmProvider: p });
  if (p === 'llama-server') {
    const url = $('llamaServerUrl')?.value?.trim();
    if (url) params.set('llamaServerUrl', url);
    const mode = $('llamaServerMode')?.value?.trim();
    if (mode === 'local' || mode === 'remote') params.set('llamaServerMode', mode);
    const key = $('llamaServerApiKey')?.value?.trim();
    if (key) params.set('llamaServerApiKey', key);
  }
  return `?${params.toString()}`;
}

/**
 * @param {string} selected Preferred model id when not resetting (e.g. saved settings).
 * @param {{ resetSelection?: boolean }} [opts] If true, only the placeholder is selected after load.
 * @returns {Promise<boolean>}
 */
async function refreshModelDropdown(selected, opts = {}) {
  const resetSelection = Boolean(opts.resetSelection);
  try {
    const r = await apiFetch('/api/llm/catalog' + catalogQueryForUiBackend());
    const c = await r.json();
    if (!r.ok) throw new Error(c.error || 'catalog failed');

    const sel = $('llmModel');
    const optsList = c.options || [];
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Select AI model';
    sel.appendChild(ph);

    for (const opt of optsList) {
      const id = String(opt.id || '').trim();
      if (!id) continue;
      const o = document.createElement('option');
      o.value = id;
      o.textContent = opt.label || id;
      sel.appendChild(o);
    }

    if (resetSelection) {
      sel.value = '';
      return true;
    }

    const want =
      (selected != null && String(selected).trim() !== '' ? String(selected).trim() : '') ||
      String(c.selectedModel || '').trim();
    if (want && [...sel.options].some((x) => x.value === want)) {
      sel.value = want;
    } else if (want) {
      const o = document.createElement('option');
      o.value = want;
      o.textContent = want + ' (custom)';
      sel.appendChild(o);
      sel.value = want;
    } else {
      sel.value = '';
    }
    return true;
  } catch (e) {
    setStatus('Model list: ' + e.message, 'err');
    return false;
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
    loadChat().catch(() => {});
    startOverviewHardwarePolling();
    startOverviewClock();
  } else {
    stopOverviewHardwarePolling();
    stopOverviewClock();
  }
  if (name === 'access') loadAccess();
  if (name === 'data') {
    let sub = 'bot';
    try {
      const v = localStorage.getItem(MEMORY_SUBTAB_KEY);
      if (v === 'bot' || v === 'session' || v === 'souls') sub = v;
    } catch {
      /* ignore */
    }
    setMemorySubtab(sub);
    loadDataTab().catch((e) => setStatus(e.message, 'err'));
  }
  if (name === 'chat') loadChat();
  if (name === 'calendar') loadCalendar();
  if (name === 'pending') loadPending();
  syncSettingsGroupForTab(name);
  queueMicrotask(() => {
    requestAnimationFrame(() => updateScrollIndicatorScrollable());
  });
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

function formatLlmBackendLabel(provider, opts = {}) {
  const p = String(provider || '').toLowerCase();
  if (p === 'llama-server') {
    const remote =
      opts.remote === true ||
      (opts.remote == null &&
        (lastSettingsForGui?.llamaServerMode === 'remote' ||
          lastSettingsForGui?.llamaServerRemote ||
          lastSettingsForGui?.llamaServerExternal === true));
    return remote ? 'llama.cpp server (remote)' : 'llama.cpp server (local)';
  }
  if (p === 'openai') return 'OpenAI (cloud)';
  if (p === 'openrouter') return 'OpenRouter (cloud)';
  if (p === 'gemini') return 'Google Gemini (cloud)';
  return 'Ollama';
}

function isLocalLlmProvider(provider) {
  const p = String(provider || '').toLowerCase();
  return p === 'ollama' || p === 'llama-server';
}

function formatDurationMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
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

/** Hardware APIs report memory in MiB */
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
      hw.monitoringSource && hw.monitoringSource !== 'built-in'
        ? `Sensors: ${hw.monitoringSource}`
        : '';
  }
}

const HARDWARE_HISTORY_MAX = 60;
const HARDWARE_POLL_MS = 2000;
let hardwareHistCpu = [];
let hardwareHistRam = [];
let hardwareHistGpu = [];
let hardwareChartTimer = null;
let overviewClockTimer = null;

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
    const r = await apiFetch('/api/system/hardware');
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

function formatUtcOffsetForDate(d) {
  const totalMin = -d.getTimezoneOffset();
  const sign = totalMin >= 0 ? '+' : '-';
  const abs = Math.abs(totalMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  let s = `UTC${sign}${h}`;
  if (m) s += ':' + String(m).padStart(2, '0');
  return s;
}

function tickOverviewClock() {
  const line = $('overviewClockLine');
  const sub = $('overviewClockTz');
  if (!line) return;
  const d = new Date();
  line.textContent = d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  if (sub) {
    try {
      const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'long' }).formatToParts(d);
      const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || '';
      sub.textContent = [tzName, formatUtcOffsetForDate(d)].filter(Boolean).join(' · ');
    } catch {
      sub.textContent = formatUtcOffsetForDate(d);
    }
  }
}

function stopOverviewClock() {
  if (overviewClockTimer) {
    clearInterval(overviewClockTimer);
    overviewClockTimer = null;
  }
}

function startOverviewClock() {
  stopOverviewClock();
  tickOverviewClock();
  overviewClockTimer = setInterval(tickOverviewClock, 1000);
}

function startOverviewHardwarePolling() {
  stopOverviewHardwarePolling();
  clearHardwareHistory();
  redrawHardwareCharts();
  refreshOverviewHardware();
  hardwareChartTimer = setInterval(refreshOverviewHardware, HARDWARE_POLL_MS);
}

function applyTelegramBotToggleUi(st) {
  const cb = $('inpBotPower');
  const lab = $('lblBotPower');
  const sub = $('sidebarBotToggleSub');
  const circle = $('sidebarAiCircleWrap');
  const footerOrb = $('sidebarFooterOrnament');
  if (!cb) return;
  botPowerSwitchSyncing = true;
  try {
    if (!st || typeof st !== 'object') {
      cb.disabled = false;
      cb.checked = false;
      lab?.removeAttribute('aria-busy');
      if (sub) sub.textContent = '?';
      if (circle) {
        circle.classList.remove('hidden', 'is-running');
      }
      footerOrb?.classList.remove('running-glow');
      return;
    }
    const running = Boolean(st.running);
    const starting = Boolean(st.starting);
    const configured = Number(st.configuredBotCount);
    const runningCount = Number(st.botCount);
    const needsRestart = Boolean(st.needsRestart);
    cb.checked = running;
    cb.disabled = starting;
    if (starting) lab?.setAttribute('aria-busy', 'true');
    else lab?.removeAttribute('aria-busy');
    if (sub) {
      if (needsRestart) {
        sub.textContent = `Restart needed (${runningCount}/${configured} bots)`;
      } else if (running && Number.isFinite(configured) && configured > 1) {
        sub.textContent = `RUNNING (${runningCount}/${configured} bots)`;
      } else {
        sub.textContent = running ? 'RUNNING' : starting ? 'Starting…' : 'Stopped';
      }
    }
    if (circle) {
      circle.classList.remove('hidden');
      circle.classList.toggle('is-running', running);
    }
    footerOrb?.classList.toggle('running-glow', running);
  } finally {
    botPowerSwitchSyncing = false;
  }
}

async function refreshSidebarBotPowerUi() {
  try {
    const st = await (await apiFetch('/api/bot/status')).json();
    applyTelegramBotToggleUi(st);
  } catch {
    applyTelegramBotToggleUi(null);
  }
}

async function loadOverview() {
  const generatedTokensCard = $('overviewCardGeneratedTokens');
  const generationTimeCard = $('overviewCardGenerationTime');
  const generationSpeedCard = $('overviewCardGenerationSpeed');
  const generatedTokensEl = $('overviewGeneratedTokens');
  const generationTimeEl = $('overviewGenerationTime');
  const generationSpeedEl = $('overviewGenerationSpeed');
  let currentProvider = '';
  let savedLlmModel = '';
  const clearLocalLlmStats = () => {
    if (generatedTokensEl) generatedTokensEl.textContent = '—';
    if (generationTimeEl) generationTimeEl.textContent = '—';
    if (generationSpeedEl) generationSpeedEl.textContent = '—';
  };
  const setLocalLlmStatsVisible = (visible) => {
    generatedTokensCard?.classList.toggle('hidden', !visible);
    generationTimeCard?.classList.toggle('hidden', !visible);
    generationSpeedCard?.classList.toggle('hidden', !visible);
  };

  const runAnimCards = ['overviewCardBotName', 'overviewCardServer', 'overviewCardTelegram']
    .map((id) => $(id))
    .filter(Boolean);
  const setRunningAnim = (on) => {
    for (const el of runAnimCards) {
      el.classList.toggle('status-card-running', Boolean(on));
    }
  };

  try {
    const settings = await (await apiFetch('/api/settings')).json();
    const display = String(settings.botPersona?.displayName || '').trim();
    const nameEl = $('overviewBotName');
    if (nameEl) {
      nameEl.textContent = display || '—';
    }

    const backEl = $('overviewLlmBackend');
    currentProvider = String(settings.llmProvider || '').toLowerCase();
    lastSettingsForGui = settings;
    if (backEl) {
      backEl.textContent = formatLlmBackendLabel(currentProvider, {
        remote: settings.llamaServerRemote || settings.llamaServerMode === 'remote',
      });
    }
    savedLlmModel = String(settings.llmModel || '').trim();
  } catch {
    currentProvider = '';
    savedLlmModel = '';
    const nameEl = $('overviewBotName');
    if (nameEl) nameEl.textContent = '—';
    const backEl = $('overviewLlmBackend');
    if (backEl) backEl.textContent = '—';
  }

  clearLocalLlmStats();
  const showLocalLlmStats = isLocalLlmProvider(currentProvider);
  setLocalLlmStatsVisible(showLocalLlmStats);
  if (showLocalLlmStats) {
    try {
      const statsRes = await apiFetch(`/api/stats/llm-usage?provider=${encodeURIComponent(currentProvider)}`);
      const stats = await statsRes.json();
      if (statsRes.ok) {
        if (generatedTokensEl) {
          const generated = Number(stats.lastCompletionTokens);
          generatedTokensEl.textContent = Number.isFinite(generated) ? generated.toLocaleString() : '—';
        }
        if (generationTimeEl) {
          generationTimeEl.textContent = formatDurationMs(stats.lastDurationMs);
        }
        if (generationSpeedEl) {
          const tps = Number(stats.lastTokensPerSec);
          generationSpeedEl.textContent = Number.isFinite(tps) && tps > 0 ? `${tps.toFixed(2)} tok/s` : '—';
        }
      }
    } catch {
      /* ignore overview local metric fetch errors */
    }
  }

  try {
    const st = await (await apiFetch('/api/bot/status')).json();
    const running = Boolean(st.running);
    const starting = Boolean(st.starting);
    const line = $('overviewTelegramLine');
    if (line) {
      line.textContent = running ? 'AI ASSISTANCE RUNNING' : starting ? 'Starting…' : 'Stopped';
    }
    if (running) {
      setStatusLed($('overviewTelegramLed'), 'live');
    } else if (starting) {
      setStatusLed($('overviewTelegramLed'), 'warn');
    } else {
      setStatusLed($('overviewTelegramLed'), 'idle');
    }
    setRunningAnim(running);
    applyTelegramBotToggleUi(st);
  } catch {
    const line = $('overviewTelegramLine');
    if (line) line.textContent = '?';
    setStatusLed($('overviewTelegramLed'), 'unknown');
    setRunningAnim(false);
    applyTelegramBotToggleUi(null);
  }

  let llmServerOnline = false;
  try {
    const ss = await (await apiFetch('/api/llm/server-status')).json();
    llmServerOnline = Boolean(ss.online);
    const lineEl = $('overviewServerLine');
    const subEl = $('overviewServerDetail');

    if (lineEl) {
      lineEl.textContent = llmServerOnline ? 'Online' : 'Offline';
    }
    if (subEl) {
      subEl.textContent = '';
    }
    if (llmServerOnline) {
      setStatusLed($('overviewServerLed'), 'live');
    } else {
      setStatusLed($('overviewServerLed'), 'idle');
    }
    setEmbeddedServerButtonRunning(Boolean(ss.embeddedRunning));
    updateEngineEmbeddedStatusFromJson(ss);
  } catch {
    llmServerOnline = false;
    const lineEl = $('overviewServerLine');
    const subEl = $('overviewServerDetail');
    if (lineEl) lineEl.textContent = '?';
    if (subEl) subEl.textContent = '';
    setStatusLed($('overviewServerLed'), 'unknown');
    setEmbeddedServerButtonRunning(false);
    updateEngineEmbeddedStatusFromJson({});
  }

  const activeModelCard = $('overviewCardActiveModel');
  const modelEl = $('overviewActiveModel');
  const localBackend = isLocalLlmProvider(currentProvider);
  const showActiveModel = !localBackend || llmServerOnline;
  if (activeModelCard) activeModelCard.classList.toggle('hidden', !showActiveModel);
  if (modelEl) {
    modelEl.textContent = showActiveModel ? savedLlmModel || '—' : '';
  }

}

async function loadAccess() {
  const r = await apiFetch('/api/admin/allowlist', { credentials: 'include' });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Allowlist failed');
  const users = d.users || [];

  const invited = users.filter((u) => u.status === 'invited');
  $('accessPendingBody').innerHTML = invited.length
    ? invited
        .map(
          (u) =>
            `<tr><td>${escapeHtml(u.email || '—')}</td><td>@${escapeHtml(u.username || '—')}</td><td>${u.telegram_user_id ?? '—'}</td><td>${escapeHtml(
              u.notes || ''
            )}</td><td>${escapeHtml(u.invited_at || '')}</td><td class="nowrap"><button type="button" class="btn-mini danger" data-allowlist-disable="${
              u.id
            }">Disable</button> <button type="button" class="btn-mini danger" data-allowlist-delete="${
              u.id
            }">Remove</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="hint">No invites yet — add an email or @username above.</td></tr>';

  const active = users.filter((u) => u.status === 'active');
  $('accessApprovedBody').innerHTML = active.length
    ? active
        .map(
          (u) =>
            `<tr><td>${escapeHtml(u.email || '—')}</td><td>@${escapeHtml(u.username || '—')}</td><td>${u.telegram_user_id ?? '—'}</td><td>${
              u.soul_user_id ?? '—'
            }</td><td>${escapeHtml(u.last_seen || '')}</td><td class="nowrap"><button type="button" class="btn-mini danger" data-allowlist-disable="${
              u.id
            }">Disable</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="hint">No active users yet.</td></tr>';

  const disabled = users.filter((u) => u.status === 'disabled');
  $('accessBlockedBody').innerHTML = disabled.length
    ? disabled
        .map(
          (u) =>
            `<tr><td>${escapeHtml(u.email || '—')}</td><td>@${escapeHtml(u.username || '—')}</td><td>${u.telegram_user_id ?? '—'}</td><td class="nowrap"><button type="button" class="btn-mini success" data-allowlist-enable="${
              u.id
            }">Re-enable</button> <button type="button" class="btn-mini danger" data-allowlist-delete="${
              u.id
            }">Remove</button></td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="hint">None.</td></tr>';
}

let accessNameModalResolve = null;

function ensureAccessNameModal() {
  let modal = $('accessNameModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'accessNameModal';
  modal.hidden = true;
  modal.innerHTML = `<div data-access-name-backdrop style="position:fixed;inset:0;background:rgba(2,6,23,.62);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;">
    <div data-access-name-panel style="width:min(460px,100%);background:#0b1220;border:1px solid rgba(96,165,250,.38);border-radius:12px;padding:14px;">
      <div style="font-weight:600;margin-bottom:10px;">Edit user name</div>
      <input id="accessNameInput" class="input" type="text" placeholder="User name" style="width:100%;" />
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
        <button type="button" id="btnAccessNameCancel" class="btn-mini ghost">Cancel</button>
        <button type="button" id="btnAccessNameConfirm" class="btn-mini success">Confirm</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const close = (value) => {
    modal.hidden = true;
    const resolver = accessNameModalResolve;
    accessNameModalResolve = null;
    if (resolver) resolver(value);
  };
  modal.querySelector('[data-access-name-backdrop]')?.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-access-name-panel]')) return;
    close(null);
  });
  modal.querySelector('#btnAccessNameCancel')?.addEventListener('click', () => close(null));
  modal.querySelector('#btnAccessNameConfirm')?.addEventListener('click', () => {
    const inp = modal.querySelector('#accessNameInput');
    close(String(inp?.value || '').trim());
  });
  modal.querySelector('#accessNameInput')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const inp = modal.querySelector('#accessNameInput');
      close(String(inp?.value || '').trim());
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close(null);
    }
  });
  return modal;
}

function openAccessNameModal(currentName) {
  const modal = ensureAccessNameModal();
  const inp = modal.querySelector('#accessNameInput');
  if (inp) {
    inp.value = String(currentName || '');
  }
  modal.hidden = false;
  setTimeout(() => {
    if (!inp) return;
    inp.focus();
    inp.select();
  }, 0);
  return new Promise((resolve) => {
    accessNameModalResolve = resolve;
  });
}

document.addEventListener('click', async (ev) => {
  const delBtn = ev.target.closest('[data-allowlist-delete]');
  if (delBtn) {
    const id = Number(delBtn.getAttribute('data-allowlist-delete'));
    if (!Number.isFinite(id)) return;
    if (!window.confirm('Remove this invite from the list?')) return;
    try {
      const r = await apiFetch(`/api/admin/allowlist/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Delete failed');
      await loadAccess();
    } catch (e) {
      setStatus(e.message, 'err');
    }
    return;
  }
  const disBtn = ev.target.closest('[data-allowlist-disable]');
  if (disBtn) {
    const id = Number(disBtn.getAttribute('data-allowlist-disable'));
    if (!Number.isFinite(id)) return;
    try {
      const r = await apiFetch(`/api/admin/allowlist/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'disabled' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Update failed');
      await loadAccess();
    } catch (e) {
      setStatus(e.message, 'err');
    }
    return;
  }
  const enBtn = ev.target.closest('[data-allowlist-enable]');
  if (enBtn) {
    const id = Number(enBtn.getAttribute('data-allowlist-enable'));
    if (!Number.isFinite(id)) return;
    try {
      const r = await apiFetch(`/api/admin/allowlist/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'invited' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Update failed');
      await loadAccess();
    } catch (e) {
      setStatus(e.message, 'err');
    }
    return;
  }
  const nameBtn = ev.target.closest('[data-access-name-edit]');
  if (nameBtn) {
    const uid = Number(nameBtn.getAttribute('data-access-name-edit'));
    if (!Number.isFinite(uid)) return;
    const current = String(nameBtn.getAttribute('data-access-current-name') || '').trim();
    const usernameNext = await openAccessNameModal(current);
    if (usernameNext == null) return;
    const username = String(usernameNext).trim();
    try {
      const r = await apiFetch('/api/access/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, username }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Name update failed');
      logLine(`Access name updated for ${uid}`);
      await loadAccess();
      await loadChat().catch(() => {});
      await loadCalendar().catch(() => {});
      await loadMemorySessionsIntoSelects().catch(() => {});
      await loadSoulForCurrentMemSession().catch(() => {});
      await loadSouls().catch(() => {});
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Access name: ' + e.message);
    }
    return;
  }
});

function formatSoulDetailPaneHtml(soul) {
  const prof =
    soul.preferences?.profile && typeof soul.preferences.profile === 'object' ? soul.preferences.profile : {};
  const bp =
    soul.preferences?.botPersona && typeof soul.preferences.botPersona === 'object'
      ? soul.preferences.botPersona
      : {};
  const chunks = [];

  const profileRows = [
    ['whoAmI', 'Who I am'],
    ['work', 'Work / occupation'],
    ['gender', 'Gender'],
    ['age', 'Age'],
    ['addressUserEn', 'Address (EN)'],
    ['addressUserMy', 'Address (MY)'],
    ['extra', 'Extra notes'],
    ['memorySummary', 'Memory summary (full)'],
    ['timezone', 'Timezone'],
  ];
  const dlParts = [];
  for (const [key, label] of profileRows) {
    const v = prof[key];
    if (v == null || String(v).trim() === '') continue;
    dlParts.push(`<dt>${escapeHtml(label)}</dt><dd class="msg">${escapeHtml(String(v))}</dd>`);
  }
  if (dlParts.length) {
    chunks.push(
      `<div class="soul-detail-section"><h4>User profile</h4><dl class="soul-detail-dl">${dlParts.join('')}</dl></div>`
    );
  }

  const bpRows = [
    ['displayName', 'Bot display name'],
    ['displayNameMy', 'Bot display name (Myanmar)'],
    ['gender', 'Bot gender'],
    ['style', 'Reply style'],
    ['role', 'Bot role'],
    ['addressUserEn', 'Bot address user (EN)'],
    ['addressUserMy', 'Bot address user (MY)'],
  ];
  const bpParts = [];
  for (const [key, label] of bpRows) {
    const v = bp[key];
    if (v == null || String(v).trim() === '') continue;
    bpParts.push(`<dt>${escapeHtml(label)}</dt><dd class="msg">${escapeHtml(String(v))}</dd>`);
  }
  if (bpParts.length) {
    chunks.push(
      `<div class="soul-detail-section"><h4>Assistant (bot) persona</h4><dl class="soul-detail-dl">${bpParts.join(
        ''
      )}</dl></div>`
    );
  }

  const prefs = soul.preferences && typeof soul.preferences === 'object' ? { ...soul.preferences } : {};
  delete prefs.profile;
  delete prefs.botPersona;
  if (Object.keys(prefs).length) {
    chunks.push(
      `<div class="soul-detail-section"><h4>Other preferences (JSON)</h4><pre class="soul-detail-pre">${escapeHtml(
        JSON.stringify(prefs, null, 2)
      )}</pre></div>`
    );
  }

  if (Array.isArray(soul.facts) && soul.facts.length) {
    chunks.push(
      `<div class="soul-detail-section"><h4>Facts</h4><pre class="soul-detail-pre">${escapeHtml(
        JSON.stringify(soul.facts, null, 2)
      )}</pre></div>`
    );
  }

  if (!chunks.length) {
    return '<p class="hint soul-detail-empty">No extended fields for this row.</p>';
  }
  return chunks.join('');
}

function toggleSoulDetailRow(summaryRow) {
  const detail = summaryRow.nextElementSibling;
  if (!detail || !detail.classList.contains('soul-detail-row')) return;
  if (detail.hasAttribute('hidden')) {
    detail.removeAttribute('hidden');
    summaryRow.setAttribute('aria-expanded', 'true');
  } else {
    detail.setAttribute('hidden', '');
    summaryRow.setAttribute('aria-expanded', 'false');
  }
}

async function loadSouls() {
  const botId = getSelectedMemoryBotId();
  const q = botId != null ? `?botId=${encodeURIComponent(String(botId))}` : '';
  const r = await apiFetch('/api/data/souls' + q);
  const d = await r.json();
  const rows = (d.souls || []).map((u) => {
    const sum = u.preferences?.profile?.memorySummary
      ? String(u.preferences.profile.memorySummary).slice(0, 120)
      : '';
    const uid = u.user_id;
    const detailId = `soul-detail-${uid}`;
    const head = `<tr class="soul-summary-row" data-soul-user="${uid}" tabindex="0" role="button" aria-expanded="false" aria-controls="${detailId}"><td>${uid}</td><td>${escapeHtml(
      u.display_name || ''
    )}</td><td class="msg">${escapeHtml(sum || '—')}</td><td>${escapeHtml(u.updated_at || '')}</td></tr>`;
    const detail = `<tr class="soul-detail-row" id="${detailId}" hidden><td colspan="4"><div class="soul-detail-pane">${formatSoulDetailPaneHtml(
      u
    )}</div></td></tr>`;
    return head + detail;
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
  const legacyBp =
    soul.preferences?.botPersona && typeof soul.preferences.botPersona === 'object'
      ? soul.preferences.botPersona
      : {};
  const addrEn = String(prof.addressUserEn ?? legacyBp.addressUserEn ?? '').trim();
  const addrMy = String(prof.addressUserMy ?? legacyBp.addressUserMy ?? '').trim();
  $('memWhoAmI').value = prof.whoAmI || '';
  if ($('memWork')) $('memWork').value = prof.work || '';
  if ($('memGender')) $('memGender').value = mapProfileGenderToSelect(prof.gender);
  if ($('memAge')) $('memAge').value = mapProfileAgeToSelect(prof.age);
  if ($('memAddressUserEn')) $('memAddressUserEn').value = addrEn;
  if ($('memAddressUserMy')) $('memAddressUserMy').value = addrMy;
  $('memExtra').value = prof.extra || '';
  if ($('memMemorySummary')) $('memMemorySummary').value = prof.memorySummary || '';
  setMemTimezoneValue(prof.timezone || '');
}

function getGlobalBotPersonaFromCache() {
  const botId = Number(currentMemoryBotId);
  const byBot = lastSettingsForGui?.botPersonaByBotId;
  const bp =
    Number.isFinite(botId) && byBot && typeof byBot === 'object'
      ? byBot[String(botId)] || lastSettingsForGui?.botPersona
      : lastSettingsForGui?.botPersona;
  return bp && typeof bp === 'object' ? bp : {};
}

function mergeBotPersonaForMemForm(soul) {
  const g = getGlobalBotPersonaFromCache();
  const l =
    soul.preferences?.botPersona && typeof soul.preferences.botPersona === 'object'
      ? soul.preferences.botPersona
      : {};
  const keys = ['displayName', 'displayNameMy', 'gender', 'style', 'role'];
  const out = { ...g };
  for (const k of keys) {
    const v = l[k];
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

function applyBotPersonaFieldsToForm(bp) {
  const p = bp || {};
  if ($('botDisplayName')) $('botDisplayName').value = p.displayName || '';
  if ($('botDisplayNameMy')) $('botDisplayNameMy').value = p.displayNameMy || '';
  if ($('botGender')) {
    const g = String(p.gender || '').trim().toLowerCase();
    if (g === 'male' || g === 'm') $('botGender').value = 'Male';
    else if (g === 'female' || g === 'f') $('botGender').value = 'Female';
    else if (p.gender === 'Male' || p.gender === 'Female') $('botGender').value = p.gender;
    else $('botGender').value = '';
  }
  if ($('botStyle')) $('botStyle').value = p.style || '';
  if ($('botRole')) $('botRole').value = p.role || '';
}

function applyMemAddressFieldsFromSettings(bp) {
  const p = bp || {};
  if ($('memAddressUserEn')) $('memAddressUserEn').value = p.addressUserEn || '';
  if ($('memAddressUserMy')) $('memAddressUserMy').value = p.addressUserMy || '';
}

function getSelectedMemoryBotId() {
  const id = Number(currentMemoryBotId);
  return Number.isFinite(id) ? id : null;
}

function getMemoryBotLabel(botId, fallback = null) {
  const names = lastSettingsForGui?.memoryBotNamesById;
  const custom =
    names && typeof names === 'object' ? String(names[String(botId)] || '').trim() : '';
  return custom || fallback || `Bot ${botId}`;
}

const MEM_TIMEZONE_SELECT_IDS = ['memUserTimezone', 'memBotUserTimezone', 'memSessionTimezone'];

const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Yangon',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

function populateMemTimezoneSelects() {
  const els = MEM_TIMEZONE_SELECT_IDS.map((id) => $(id)).filter(Boolean);
  if (!els.length) return;
  let zones = [];
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    try {
      zones = Intl.supportedValuesOf('timeZone');
    } catch {
      zones = [];
    }
  }
  if (!zones.length) zones = FALLBACK_TIMEZONES;
  const html =
    '<option value="">Server default</option>' +
    zones
      .slice()
      .sort()
      .map((z) => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`)
      .join('');
  for (const el of els) el.innerHTML = html;
}

function getMemTimezoneValue() {
  for (const id of MEM_TIMEZONE_SELECT_IDS) {
    const el = $(id);
    if (el) return String(el.value || '').trim();
  }
  return '';
}

function setMemTimezoneValue(tz) {
  const v = String(tz || '').trim();
  for (const id of MEM_TIMEZONE_SELECT_IDS) {
    const el = $(id);
    if (el) el.value = v;
  }
}

function syncMemTimezoneSelects(fromEl) {
  const v = fromEl ? String(fromEl.value || '').trim() : getMemTimezoneValue();
  for (const id of MEM_TIMEZONE_SELECT_IDS) {
    const el = $(id);
    if (el && el !== fromEl) el.value = v;
  }
}

function renderMemoryBotSelect(bots) {
  const sel = $('memBotSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const list = Array.isArray(bots) ? bots : [];
  if (!list.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'No Telegram bots — add tokens on the Telegram tab';
    sel.appendChild(o);
    currentMemoryBotId = null;
    return;
  }
  let idx = 0;
  for (const b of list) {
    const botId = Number(b.botId);
    if (!Number.isFinite(botId)) continue;
    idx += 1;
    const o = document.createElement('option');
    o.value = String(botId);
    const uname = String(b?.username || '').trim().replace(/^@+/, '');
    o.textContent = uname
      ? getMemoryBotLabel(botId, `@${uname}`)
      : getMemoryBotLabel(botId, `Bot ${idx}`);
    sel.appendChild(o);
  }
  if (currentMemoryBotId != null && [...sel.options].some((x) => x.value === String(currentMemoryBotId))) {
    sel.value = String(currentMemoryBotId);
  }
}


async function saveMemoryBotTabName(botId, name) {
  const existing =
    lastSettingsForGui?.memoryBotNamesById && typeof lastSettingsForGui.memoryBotNamesById === 'object'
      ? { ...lastSettingsForGui.memoryBotNamesById }
      : {};
  const n = String(name || '').trim();
  if (n) existing[String(botId)] = n;
  else delete existing[String(botId)];
  const r = await apiFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memoryBotNamesById: existing }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Rename failed');
  lastSettingsForGui = j.settings || lastSettingsForGui;
}

async function loadMemoryBotOptions() {
  const prev = Number.isFinite(currentMemoryBotId) ? String(currentMemoryBotId) : '';
  const r = await apiFetch('/api/memory/bots');
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Failed to load Telegram bots');
  const bots = (Array.isArray(d.bots) ? d.bots : []).filter((b) => Number.isFinite(Number(b.botId)));
  let saved = '';
  try {
    saved = localStorage.getItem(MEMORY_BOT_KEY) || '';
  } catch {
    /* ignore */
  }
  const pick =
    (saved && bots.some((x) => String(x.botId) === saved) && saved) ||
    (prev && bots.some((x) => String(x.botId) === prev) && prev) ||
    (bots[0] ? String(bots[0].botId) : '') ||
    '';
  currentMemoryBotId = pick ? Number(pick) : null;
  try {
    localStorage.setItem(MEMORY_BOT_KEY, pick);
  } catch {
    /* ignore */
  }
  renderMemoryBotSelect(bots);
}

async function loadMemorySessionsIntoSelects() {
  const botId = getSelectedMemoryBotId();
  const q = botId != null ? `?botId=${encodeURIComponent(String(botId))}` : '';
  const d = await apiFetch('/api/memory/sessions' + q).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  const sessions = d.sessions || [];
  const memSel = $('memSessionSelect');
  const copySel = $('memCopyFromSelect');
  const copyBotSel = $('memCopyBotFromSelect');
  if (!memSel || !copySel) return;
  const prevMem = memSel.value;
  const prevCopy = copySel.value;
  const prevBotCopy = copyBotSel?.value;
  memSel.innerHTML = '';
  copySel.innerHTML = '<option value="">Select source session…</option>';
  if (copyBotSel) copyBotSel.innerHTML = '<option value="">Select source session…</option>';
  for (const s of sessions) {
    const o = document.createElement('option');
    o.value = String(s.userId);
    o.textContent = `${s.label}`;
    memSel.appendChild(o);
    const c = document.createElement('option');
    c.value = String(s.userId);
    c.textContent = `${s.label}`;
    copySel.appendChild(c);
    if (copyBotSel) {
      const b = document.createElement('option');
      b.value = String(s.userId);
      b.textContent = `${s.label}`;
      copyBotSel.appendChild(b);
    }
  }
  if (prevMem && [...memSel.options].some((x) => x.value === prevMem)) {
    memSel.value = prevMem;
  } else {
    const guiId = getGuiConsoleUserIdFromData(d);
    let saved = '';
    try {
      saved = localStorage.getItem(CHAT_SESSION_STORAGE_KEY) || '';
    } catch {
      /* ignore */
    }
    const pick =
      (saved && [...memSel.options].some((x) => x.value === saved) && saved) || String(guiId);
    memSel.value = [...memSel.options].some((x) => x.value === pick) ? pick : memSel.options[0]?.value || '';
  }
  if (prevCopy && [...copySel.options].some((x) => x.value === prevCopy)) copySel.value = prevCopy;
  if (
    copyBotSel &&
    prevBotCopy &&
    [...copyBotSel.options].some((x) => x.value === prevBotCopy)
  ) {
    copyBotSel.value = prevBotCopy;
  }
}

async function loadSoulForCurrentMemSession() {
  const uid = Number($('memSessionSelect')?.value);
  if (!Number.isFinite(uid)) {
    const g = getGlobalBotPersonaFromCache();
    applyBotPersonaFieldsToForm(g);
    applyMemAddressFieldsFromSettings(g);
    if ($('memDisplayName')) $('memDisplayName').value = '';
    if ($('memWhoAmI')) $('memWhoAmI').value = '';
    if ($('memWork')) $('memWork').value = '';
    if ($('memGender')) $('memGender').value = '';
    if ($('memAge')) $('memAge').value = '';
    if ($('memExtra')) $('memExtra').value = '';
    if ($('memMemorySummary')) $('memMemorySummary').value = '';
    renderRecordsMemTable([]);
    return;
  }
  const r = await apiFetch(`/api/soul/${uid}`);
  const soul = await r.json();
  if (soul.error) throw new Error(soul.error);
  applySoulToMemForm(soul);
  applyBotPersonaFieldsToForm(mergeBotPersonaForMemForm(soul));
  await loadRecordsMemTable().catch(() => {});
}

function recordMetaSchedulePreview(metaRaw) {
  try {
    const o = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
    if (o && typeof o.schedule === 'string' && o.schedule.trim()) return o.schedule.trim();
  } catch {
    /* ignore */
  }
  return '';
}

function renderRecordsMemTable(rows) {
  const tbody = $('recordsMemBody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="hint">No saved rows for this session.</td></tr>';
    return;
  }
  const parts = [];
  for (const rec of rows) {
    const sched = recordMetaSchedulePreview(rec.meta);
    const notes = [sched, rec.notes || ''].filter(Boolean).join(sched && rec.notes ? ' · ' : '');
    const amtDisp =
      rec.amount != null && Number.isFinite(Number(rec.amount))
        ? escapeHtml(String(rec.amount) + (rec.currency ? ` ${rec.currency}` : ''))
        : '—';
    parts.push(
      `<tr><td>${rec.id}</td><td>${escapeHtml(rec.record_type || '')}</td><td>${escapeHtml(
        rec.occurred_on || '—'
      )}</td><td>${escapeHtml(rec.title || '')}</td><td>${amtDisp}</td><td>${escapeHtml(
        notes || '—'
      )}</td><td><button type="button" class="danger ghost btn-delete-record-mem" data-record-id="${rec.id}">Delete</button></td></tr>`
    );
  }
  tbody.innerHTML = parts.join('');
}

async function loadRecordsMemTable() {
  const uid = Number($('memSessionSelect')?.value);
  const tbody = $('recordsMemBody');
  if (!tbody) return;
  if (!Number.isFinite(uid)) {
    renderRecordsMemTable([]);
    return;
  }
  const r = await apiFetch(`/api/data/records?userId=${encodeURIComponent(uid)}&limit=200`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  renderRecordsMemTable(Array.isArray(data.records) ? data.records : []);
}

async function loadDataTab() {
  populateMemTimezoneSelects();
  await loadMemoryBotOptions();
  await loadSouls();
  await loadMemorySessionsIntoSelects();
  await loadSoulForCurrentMemSession().catch(() => {});
}

function getGuiConsoleUserIdFromData(data) {
  return data?.guiConsoleUserId != null ? Number(data.guiConsoleUserId) : 900000001;
}

function getActiveChatSelect() {
  return $('chatSessionSelect');
}

function getActiveChatInputEl() {
  const overviewActive = Boolean(document.getElementById('panel-overview')?.classList.contains('active'));
  if (overviewActive && $('overviewChatInput')) return $('overviewChatInput');
  return $('chatInput') || $('overviewChatInput');
}

function activeChatPaneKey() {
  return Boolean(document.getElementById('panel-overview')?.classList.contains('active')) ? 'overview' : 'chat';
}

function getActivePendingChatImage() {
  return pendingChatImageByPane[activeChatPaneKey()];
}

function setPendingChatImageForPane(pane, payload) {
  pendingChatImageByPane[pane] = payload || null;
  const line = payload ? `Attached image: ${payload.name}` : 'Image attachment cleared.';
  logLine(line);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read selected image file.'));
    fr.onload = () => resolve(String(fr.result || ''));
    fr.readAsDataURL(file);
  });
}

function syncChatLimitSelects(value) {
  for (const id of ['chatLimit']) {
    const el = $(id);
    if (el && [...el.options].some((x) => x.value === value)) el.value = value;
  }
}

function updateChatSessionHint(selectEl) {
  if (!selectEl) return;
  const uid = Number(selectEl.value);
  const opt = selectEl.selectedOptions[0];
  const text = `Active user: ${opt ? opt.textContent : uid}`;
  const hintIds = ['chatSessionHint'];
  for (const id of hintIds) {
    const hintEl = $(id);
    if (hintEl) hintEl.textContent = text;
  }
}

function buildSessionSelect(sessionsPayload) {
  const guiId = getGuiConsoleUserIdFromData(sessionsPayload);
  lastGuiConsoleUserId = guiId;
  const sessions = sessionsPayload?.sessions || [];
  const sel = $('chatSessionSelect');
  if (!sel) return guiId;
  const prev = getActiveChatSelect()?.value || '';
  sel.innerHTML = '';
  const oGui = document.createElement('option');
  oGui.value = String(guiId);
  oGui.textContent = 'Control panel (local test)';
  sel.appendChild(oGui);
  for (const s of sessions) {
    const o = document.createElement('option');
    o.value = String(s.userId);
    o.textContent = `${s.label}`;
    sel.appendChild(o);
  }
  const saved = localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
  const pick =
    (saved && [...sel.options].some((x) => x.value === saved) && saved) ||
    (prev && [...sel.options].some((x) => x.value === prev) && prev) ||
    String(guiId);
  sel.value = pick;
  updateChatSessionHint(sel);
  return guiId;
}

function renderChatThreadInto(thread, messages, scrollOpts = {}) {
  const { forceBottom = false } = scrollOpts;
  if (!thread) return;
  const list = messages || [];
  if (!list.length) {
    thread.innerHTML = '<p class="hint chat-empty">No messages in this session yet.</p>';
    thread.scrollTop = 0;
    return;
  }
  const prevTop = thread.scrollTop;
  const prevHeight = thread.scrollHeight;
  const prevClient = thread.clientHeight;
  const distFromBottom = prevHeight - prevTop - prevClient;
  const wasNearBottom = distFromBottom < CHAT_STICK_BOTTOM_THRESHOLD_PX;

  const parts = [];
  for (const m of list) {
    const role = String(m.role || '').toLowerCase();
    if (role === 'system') continue;
    const t = m.created_at ? formatChatTimestampLocal(m.created_at) : '';
    const cls = role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant';
    const who = role === 'user' ? 'You' : 'Assistant';
    parts.push(
      `<div class="${cls}"><span class="chat-meta">${escapeHtml(t)} · ${escapeHtml(who)}</span><div class="chat-text">${escapeHtml(
        m.content || ''
      ).replace(/\n/g, '<br/>')}</div></div>`
    );
  }
  thread.innerHTML = parts.join('');

  if (forceBottom || wasNearBottom) {
    thread.scrollTop = thread.scrollHeight;
  } else {
    const maxScroll = Math.max(0, thread.scrollHeight - thread.clientHeight);
    thread.scrollTop = Math.min(Math.max(0, prevTop), maxScroll);
  }
}

function renderChatThread(messages, scrollOpts = {}) {
  renderChatThreadInto($('chatThread'), messages, scrollOpts);
  renderChatThreadInto($('overviewChatThread'), messages, scrollOpts);
}

function setChatSendUiBusy(busy) {
  for (const id of ['btnChatSend', 'btnOverviewChatSend']) {
    const btn = $(id);
    if (btn) btn.disabled = Boolean(busy);
  }
}

function appendAndRenderChatMessage(role, content, userId, opts = {}) {
  const nowIso = new Date().toISOString();
  const msg = {
    role,
    content: String(content || ''),
    created_at: opts.createdAt || nowIso,
    user_id: userId,
  };
  const sameSession = Number(lastChatLoadedUserId) === Number(userId);
  if (sameSession) {
    lastChatMessages = [...lastChatMessages, msg];
  } else {
    lastChatMessages = [msg];
    lastChatLoadedUserId = Number(userId);
  }
  renderChatThread(lastChatMessages, { forceBottom: true });
}

async function loadChat(opts = {}) {
  if (chatSendInFlight && !opts.forceDuringSend) return;
  const overviewActive = Boolean(document.getElementById('panel-overview')?.classList.contains('active'));
  const limit = overviewActive ? OVERVIEW_CHAT_LIMIT : $('chatLimit')?.value || '100';
  if (!overviewActive) syncChatLimitSelects(limit);
  const sess = await apiFetch('/api/chat/sessions').then((r) => r.json());
  if (sess.error) throw new Error(sess.error);
  buildSessionSelect(sess);
  const activeUid = overviewActive ? lastGuiConsoleUserId : Number(getActiveChatSelect()?.value);
  const sessionChanged = lastChatLoadedUserId !== activeUid;
  const forceBottom = Boolean(opts.forceBottom) || sessionChanged;
  localStorage.setItem(CHAT_SESSION_STORAGE_KEY, String(activeUid));
  const q = new URLSearchParams({ limit });
  q.set('userId', String(activeUid));
  const data = await apiFetch('/api/chat?' + q.toString()).then((r) => r.json());
  if (data.error) throw new Error(data.error);
  lastChatMessages = Array.isArray(data.messages) ? data.messages : [];
  renderChatThread(lastChatMessages, { forceBottom });
  lastChatLoadedUserId = activeUid;
}

async function sendChatFromGui() {
  if (chatSendInFlight) return;
  const overviewActive = Boolean(document.getElementById('panel-overview')?.classList.contains('active'));
  const input = getActiveChatInputEl();
  const text = (input?.value || '').trim();
  const image = getActivePendingChatImage();
  if (!text && !image) return;
  const userId = overviewActive ? lastGuiConsoleUserId : Number(getActiveChatSelect()?.value);
  if (!Number.isFinite(userId)) {
    setStatus('Chat session is unavailable.', 'err');
    return;
  }
  chatSendInFlight = true;
  setChatSendUiBusy(true);
  const paneKey = activeChatPaneKey();
  input.value = '';
  input.focus();
  setPendingChatImageForPane(paneKey, null);
  const userPreview = [text, image ? '[Image attached]' : ''].filter(Boolean).join('\n');
  appendAndRenderChatMessage('user', userPreview || '[Image]', userId);
  setStatus('Thinking…', '');
  try {
    const r = await apiFetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, text, imageDataUrl: image?.dataUrl || '' }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Send failed');
    appendAndRenderChatMessage('assistant', String(j.reply || '(empty model response)'), userId);
    if (j.wantConfirmKeyboard) {
      logLine('Assistant asked for Yes/No — type Yes or No in the chat box.');
    }
    const provider = String(j.meta?.provider || '').trim();
    const model = String(j.meta?.model || '').trim();
    const elapsedMs = Number(j.meta?.elapsedMs || 0);
    if (provider || model || elapsedMs > 0) {
      const bits = [];
      if (provider) bits.push(provider);
      if (model) bits.push(model);
      if (elapsedMs > 0) bits.push(`${elapsedMs}ms`);
      logLine(`Reply ready: ${bits.join(' | ')}`);
    }
    setStatus('', '');
    loadChat({ forceBottom: true, forceDuringSend: true }).catch(() => {});
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Chat: ' + e.message);
    if (!input.value) input.value = text;
    if (image && !pendingChatImageByPane[paneKey]) setPendingChatImageForPane(paneKey, image);
    await loadChat({ forceBottom: true, forceDuringSend: true }).catch(() => {});
  } finally {
    chatSendInFlight = false;
    setChatSendUiBusy(false);
    input.focus();
  }
}

async function clearChatDataBySessionWithDoubleConfirmation() {
  const uid = Number(getActiveChatSelect()?.value);
  if (!Number.isFinite(uid)) {
    setStatus('Pick a valid chat session first.', 'err');
    return;
  }
  const ok1 = window.confirm(
    `Clear all chat messages for this session?\n\nThis affects the selected session only.`
  );
  if (!ok1) return;
  const ok2 = window.confirm(
    `Second confirmation: permanently delete chat history for session ${uid}?\n\nThis cannot be undone.`
  );
  if (!ok2) return;
  setStatus('Clearing session chat…', '');
  try {
    const r = await apiFetch('/api/chat/clear-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Clear failed');
    logLine(`Cleared ${Number(j.deleted || 0)} chat row(s) for session ${uid}.`);
    setStatus('Session chat cleared.', 'ok');
    await loadChat({ forceBottom: true });
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Clear session chat: ' + e.message);
  }
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
  return d.toLocaleString();
}

function openCalendarDayModal(dayDate, events) {
  const modal = $('calendarDayModal');
  const title = $('calendarDayModalTitle');
  const body = $('calendarDayModalBody');
  if (!modal || !title || !body) return;

  title.textContent = `Events on ${dayDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  body.innerHTML = events
    .map((e) => {
      const userId = Number(e.user_id);
      const createdAt = e.created_at ? formatEventDateTime(e.created_at) : '—';
      return `<article class="calendar-modal-event">
        <p><strong>Title:</strong> ${escapeHtml(e.title || '')}</p>
        <p><strong>Starts:</strong> ${escapeHtml(formatEventDateTime(e.starts_at))}</p>
        <p><strong>User:</strong> ${escapeHtml(String(e.user_name || e.username || e.display_name || (Number.isFinite(userId) ? String(userId) : String(e.user_id || ''))))}</p>
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
  const r = await apiFetch('/api/data/calendar?limit=500');
  const d = await r.json();
  calendarEventsCache = Array.isArray(d.events) ? d.events : [];
  renderCalendarMonth();
}

async function loadPending() {
  const r = await apiFetch('/api/data/pending');
  const d = await r.json();
  const rows = (d.pending || []).map((p) => {
    const payload =
      typeof p.payload === 'object' ? JSON.stringify(p.payload) : String(p.payload || '');
    const uid = Number(p.user_id);
    return `<tr><td>${p.user_id}</td><td>${escapeHtml(p.kind)}</td><td class="msg">${escapeHtml(payload)}</td><td>${escapeHtml(
      p.created_at || ''
    )}</td><td class="nowrap"><button type="button" class="btn-mini danger" data-pending-delete="${
      Number.isFinite(uid) ? uid : ''
    }">Delete</button></td></tr>`;
  });
  $('pendingBody').innerHTML = rows.length
    ? rows.join('')
    : '<tr><td colspan="5" class="hint">None.</td></tr>';
}

async function saveAll() {
  try {
    const modelsDirValue = effectiveModelsDirForSave();
    const llamaRemote = isLlamaRemoteModeFromForm();
    const body = {
      llmProvider: $('llmProvider').value,
      ollamaBaseUrl: $('ollamaBaseUrl').value.trim(),
      ...buildLlamaEnginePatch(),
      modelsDir: modelsDirValue,
      ggufPath: llamaRemote ? undefined : $('ggufPath')?.value?.trim() || '',
      mmprojPath: llamaRemote ? undefined : $('mmprojPath')?.value?.trim() || '',
      guiPort: $('guiPort').value,
      logLevel: $('logLevel').value,
      browserTimeoutMs: $('browserTimeoutMs').value,
      maxBrowsePages: $('maxBrowsePages').value,
      databaseUrl: $('databaseUrl').value.trim(),
      openBrowserGui: $('openBrowserGui').checked,
      webSearchEnabled: $('webSearchEnabled') ? $('webSearchEnabled').checked : false,
    };
    const tok = $('telegramBotToken').value.trim();
    if (tok) {
      if (lastSettingsForGui?.hasSavedToken) {
        if (!confirmReplaceSavedTelegramToken()) {
          setStatus('Save cancelled — bot tokens unchanged.', '');
          return;
        }
      }
      body.telegramBotTokenAdd = tok;
    }
    setStatus('Saving…', '');
    const oa = $('openaiApiKey')?.value?.trim() || '';
    if (oa) body.openaiApiKey = oa;
  const or = $('openrouterApiKey')?.value?.trim() || '';
  if (or) body.openrouterApiKey = or;
  body.openrouterBaseUrl = $('openrouterBaseUrl')?.value?.trim() || '';
  const gm = $('geminiApiKey')?.value?.trim() || '';
    if (gm) body.geminiApiKey = gm;
    const r = await apiFetch('/api/settings', {
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

async function testLocalLlmConnection() {
  const provider = String($('llmProvider')?.value || '').trim().toLowerCase();
  if (!isLocalLlmProvider(provider)) {
    setStatus('Test Connection supports only local backends.', '');
    return;
  }
  const baseUrl =
    provider === 'ollama'
      ? String($('ollamaBaseUrl')?.value || '').trim()
      : String($('llamaServerUrl')?.value || '').trim();
  if (!baseUrl) {
    setStatus('Base URL is required.', 'err');
    return;
  }
  const btn = $('btnTestLocalLlm');
  const hint = $('localLlmTestHint');
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = `Testing ${provider} connection…`;
  try {
    const testBody = { provider, baseUrl };
    if (provider === 'llama-server') {
      const apiKey = $('llamaServerApiKey')?.value?.trim() || '';
      if (apiKey) testBody.llamaServerApiKey = apiKey;
    }
    const r = await apiFetch('/api/llm/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testBody),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Connection test failed');
    const msg = String(j.message || 'Connection successful.');
    if (hint) hint.textContent = msg;
    setStatus(msg, 'ok');
    if (provider === 'llama-server' && isLlamaRemoteModeFromForm()) {
      await populateRemoteModelSelect($('llmModelRemote')?.value || $('llmModel')?.value);
    }
  } catch (e) {
    const msg = String(e.message || 'Connection test failed');
    if (hint) hint.textContent = msg;
    setStatus(msg, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function buildLlamaEnginePatch() {
  syncHiddenModelFromLlamaUi();
  const remote = isLlamaRemoteModeFromForm();
  const chosenModelId = remote
    ? String($('llmModelRemote')?.value || $('llmModel')?.value || '').trim()
    : String($('llmModel')?.value || '').trim() || getModelIdFromGgufLabel();
  const patch = {
    llamaServerMode: remote ? 'remote' : 'local',
  };
  const urlEl = $('llamaServerUrl');
  if (urlEl) patch.llamaServerUrl = urlEl.value.trim();
  if (chosenModelId) patch.llmModel = chosenModelId;
  const key = $('llamaServerApiKey')?.value?.trim() || '';
  if (key) patch.llamaServerApiKey = key;
  return patch;
}

async function saveEngineSettingsOnly() {
  const modelsDirValue = effectiveModelsDirForSave();
  const llamaRemote = isLlamaRemoteModeFromForm();
  const body = {
    llmProvider: $('llmProvider').value,
    ollamaBaseUrl: $('ollamaBaseUrl').value.trim(),
    modelsDir: modelsDirValue,
    ...buildLlamaEnginePatch(),
  };
  if (!llamaRemote) {
    body.ggufPath = $('ggufPath')?.value?.trim() || '';
    body.mmprojPath = $('mmprojPath')?.value?.trim() || '';
  }
  const r = await apiFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Save failed');
  lastSettingsForGui = j.settings || lastSettingsForGui;
  const s = j.settings || {};
  if ($('llamaServerMode')) {
    const remoteMode =
      s.llamaServerMode === 'remote' || Boolean(s.llamaServerRemote) || s.llamaServerExternal === true;
    $('llamaServerMode').value = remoteMode ? 'remote' : 'local';
    updateProviderVisibility();
  }
  const ggufEl = $('ggufPath');
  if (ggufEl) {
    const resolvedGguf = String(s.ggufPath || '').trim();
    const rawGguf = String(s.ggufPathInput || '').trim();
    ggufEl.value = resolvedGguf || rawGguf;
  }
  const mmEl = $('mmprojPath');
  if (mmEl) {
    const resolvedMm = String(s.mmprojPath || '').trim();
    const rawMm = String(s.mmprojPathInput || '').trim();
    mmEl.value = resolvedMm || rawMm;
  }
  const mdAfter = $('modelsDir');
  if (mdAfter) {
    const g2 = $('ggufPath')?.value?.trim() || '';
    const dirFromGguf = deriveModelsDirFromGgufPath(g2);
    if (dirFromGguf) mdAfter.value = dirFromGguf;
  }
  syncEnginePathReadouts();
  updateSelectedGgufLabel($('llmModel')?.value || '');
  updateSelectedMmprojLabel();
  return j.settings || {};
}

async function startEmbeddedLlamaServer() {
  const provider = String($('llmProvider')?.value || '').trim().toLowerCase();
  if (!isLocalLlmProvider(provider)) {
    setStatus('Embedded server is available for local backends.', 'err');
    return;
  }
  const btn = $('btnStartEmbeddedServer');
  const label = provider === 'ollama' ? 'Ollama' : 'llama.cpp';
  try {
    if (embeddedServerRunning) {
      if (btn) btn.disabled = true;
      setStatus(`Stopping embedded ${label} server…`, '');
      const r = await apiFetch('/api/llm/stop-server', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Stop failed');
      const msg = 'Embedded server stopped.';
      setStatus(msg, 'ok');
      logLine(msg);
      showToast(msg, 'ok');
      setEmbeddedServerButtonRunning(false);
      await loadOverview();
      await refreshEmbeddedServerButtonState();
      return;
    }
    const ggufPathCheck = $('ggufPath')?.value?.trim() || '';
    if (provider === 'llama-server' && isLlamaRemoteModeFromForm()) {
      setStatus('Embedded server is not used for remote mode.', 'err');
      return;
    }
    if (provider === 'llama-server' && !ggufPathCheck) {
      const msg = 'Pick a main .gguf model file before starting the embedded server.';
      setStatus(msg, 'err');
      showToast(msg, 'err');
      return;
    }
    embeddedStartInFlight = true;
    applyEmbeddedStartDisabledState();
    updateEngineEmbeddedStatusFromJson({ embeddedPanel: {}, embeddedRunning: false, listening: false });
    if (btn) btn.disabled = true;
    setStatus(`Starting embedded ${label} server…`, '');
    try {
      if (provider === 'llama-server') {
        await saveEngineSettingsOnly();
        const bind = parseLlamaBindFromForm();
        const ggufPath = $('ggufPath')?.value?.trim() || '';
        const mmprojPath = $('mmprojPath')?.value?.trim() || '';
        const r = await apiFetch('/api/llm/start-embedded', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ggufPath,
            mmprojPath,
            ctxSize: 4096,
            host: bind.host,
            port: bind.port,
          }),
        });
        const j = await r.json();
        if (!r.ok) {
          const err = String(j.error || 'Start failed');
          showToast(err, 'err');
          throw new Error(err);
        }
        const msg = `Embedded llama-server listening at ${j.url || ''}.`;
        setStatus(msg, 'ok');
        logLine(msg);
        showToast('Embedded llama-server started.', 'ok');
        await loadSettingsIntoForm();
        setEmbeddedServerButtonRunning(true);
        await loadOverview();
        return;
      }
      await saveEngineSettingsOnly();
      const r = await apiFetch('/api/llm/start-server', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Start failed');
      const msg = j.skipped ? 'Server already running.' : `Embedded ${label} server started.`;
      setStatus(msg, 'ok');
      logLine(msg);
      showToast(msg, 'ok');
      setEmbeddedServerButtonRunning(true);
      await loadOverview();
    } finally {
      embeddedStartInFlight = false;
      applyEmbeddedStartDisabledState();
      if (btn) btn.disabled = false;
      await refreshEmbeddedServerButtonState();
    }
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Embedded server toggle: ' + e.message);
    embeddedStartInFlight = false;
    applyEmbeddedStartDisabledState();
    if (btn) btn.disabled = false;
    await refreshEmbeddedServerButtonState();
  }
}

async function pickGgufFile() {
  const modelsDirInput = $('modelsDir');
  const llmModelInput = $('llmModel');
  const ggufPathInput = $('ggufPath');
  if (!modelsDirInput) {
    setStatus('Models folder input is not available in this view.', 'err');
    return;
  }
  if (!llmModelInput) {
    setStatus('Model input is not available in this view.', 'err');
    return;
  }
  const ipcPickers = [];
  if (window.senaDialogs && typeof window.senaDialogs.pickGgufFile === 'function') {
    ipcPickers.push(() => window.senaDialogs.pickGgufFile());
  }
  const picked = await pickLocalGgufFilesystemPath(ipcPickers);
  const fullPath = String(picked?.fullPath || '').trim();
  const fallbackFileName = String(picked?.fileName || '').trim();
  if (!fullPath && !fallbackFileName) {
    setStatus(
      'Could not read a filesystem path for the chosen file. Paste the full path into the field below.',
      'err'
    );
    return;
  }

  if (!fullPath) {
    const msg = `Could not read the real filesystem path for "${fallbackFileName || 'the chosen file'}". Browsers often hide absolute paths — paste the full path into the field below.`;
    setStatus(msg, 'err');
    showToast(msg, 'err');
    const dg = $('displayMainModelPath');
    if (dg) dg.focus();
    return;
  }
  const modelId = parseGgufModelIdFromPath(fullPath);
  const folder = fullPath.replace(/[\\/][^\\/]+$/, '');
  modelsDirInput.value = folder;
  if (ggufPathInput) ggufPathInput.value = fullPath;
  if (modelId) {
    ensureModelOptionSelected(modelId);
    llmModelInput.value = modelId;
  }
  syncEnginePathReadouts();
  updateSelectedGgufLabel(modelId);
  await saveEngineSettingsOnly();
  setStatus(`Local model selected: ${fullPath}`, 'ok');
  showToast(`Selected ${basenamePath(fullPath)}`, 'ok');
}

async function pickMmprojFile() {
  const mmprojInput = $('mmprojPath');
  const modelsDirInput = $('modelsDir');
  if (!mmprojInput) {
    setStatus('mmproj path field is not available in this view.', 'err');
    return;
  }
  const ipcPickers = [];
  if (window.senaDialogs) {
    if (typeof window.senaDialogs.pickMmprojGgufFile === 'function') {
      ipcPickers.push(() => window.senaDialogs.pickMmprojGgufFile());
    }
    if (typeof window.senaDialogs.pickGgufFile === 'function') {
      ipcPickers.push(() => window.senaDialogs.pickGgufFile());
    }
  }
  const picked = await pickLocalMmprojFilesystemPath(ipcPickers);
  const fullPath = String(picked?.fullPath || '').trim();
  const fallbackFileName = String(picked?.fileName || '').trim();
  if (!fullPath && !fallbackFileName) {
    setStatus(
      'Could not read a filesystem path for the chosen projector file. Paste the full path into the field below.',
      'err'
    );
    return;
  }
  if (!fullPath) {
    const msg = `Could not read the real filesystem path for "${fallbackFileName || 'the chosen projector file'}". Browsers often hide absolute paths — paste the full path into the field below.`;
    setStatus(msg, 'err');
    showToast(msg, 'err');
    const dm = $('displayMmprojPath');
    if (dm) dm.focus();
    return;
  }
  if (modelsDirInput) {
    const mmprojDir = fullPath.replace(/[\\/][^\\/]+$/, '');
    if (mmprojDir) modelsDirInput.value = mmprojDir;
  }
  mmprojInput.value = fullPath;
  syncEnginePathReadouts();
  updateSelectedMmprojLabel();
  await saveEngineSettingsOnly();
  setStatus(`Projector selected: ${fullPath}`, 'ok');
  showToast(`Projector: ${basenamePath(fullPath)}`, 'ok');
}

async function clearMmprojSelection() {
  const mmprojInput = $('mmprojPath');
  if (!mmprojInput) return;
  mmprojInput.value = '';
  syncEnginePathReadouts();
  updateSelectedMmprojLabel();
  await saveEngineSettingsOnly();
  setStatus('mmproj cleared.', 'ok');
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
  refreshModelDropdown('', { resetSelection: true }).catch(() => {});
});

$('llamaServerMode')?.addEventListener('change', () => {
  updateProviderVisibility();
  if (!isLlamaRemoteModeFromForm()) {
    refreshModelDropdown($('llmModel')?.value || '', { resetSelection: false }).catch(() => {});
  }
});

$('btnRefreshRemoteModels')?.addEventListener('click', () => {
  populateRemoteModelSelect($('llmModelRemote')?.value || $('llmModel')?.value).catch((e) =>
    setStatus(e.message, 'err')
  );
});

$('llmModelRemote')?.addEventListener('change', () => syncHiddenModelFromLlamaUi());

$('btnRefreshModels')?.addEventListener('click', () => {
  const cur = $('llmModel')?.value?.trim() || '';
  refreshModelDropdown(cur, { resetSelection: false });
});

$('btnTestLocalLlm')?.addEventListener('click', () => {
  testLocalLlmConnection().catch((e) => setStatus(e.message, 'err'));
});

$('btnStartEmbeddedServer')?.addEventListener('click', () => {
  startEmbeddedLlamaServer().catch((e) => setStatus(e.message, 'err'));
});

$('btnPickGgufFile')?.addEventListener('click', () => {
  pickGgufFile().catch((e) => setStatus(e.message, 'err'));
});

$('btnPickMmprojFile')?.addEventListener('click', () => {
  pickMmprojFile().catch((e) => setStatus(e.message, 'err'));
});

$('btnClearMmproj')?.addEventListener('click', () => {
  clearMmprojSelection().catch((e) => setStatus(e.message, 'err'));
});

/** Sync manual edits in the visible path field back to the hidden #ggufPath / #mmprojPath. */
function wirePathReadoutInput(displayId, hiddenId, opts = {}) {
  const display = $(displayId);
  const hidden = $(hiddenId);
  if (!display || !hidden) return;
  const onCommit = async () => {
    const v = display.value.trim();
    hidden.value = v;
    if (opts.kind === 'gguf') {
      const modelId = parseGgufModelIdFromPath(v);
      if (modelId) {
        ensureModelOptionSelected(modelId);
        const sel = $('llmModel');
        if (sel) sel.value = modelId;
      }
      const md = $('modelsDir');
      const dir = deriveModelsDirFromGgufPath(v);
      if (md && dir) md.value = dir;
      updateSelectedGgufLabel(modelId);
    } else {
      updateSelectedMmprojLabel();
    }
    try {
      await saveEngineSettingsOnly();
      if (v) showToast(`Path saved: ${basenamePath(v)}`, 'ok');
    } catch (e) {
      setStatus(e.message, 'err');
    }
  };
  display.addEventListener('input', () => {
    hidden.value = display.value.trim();
    if (opts.kind === 'gguf') updateSelectedGgufLabel(parseGgufModelIdFromPath(display.value.trim()));
    else updateSelectedMmprojLabel();
    applyEmbeddedStartDisabledState();
  });
  display.addEventListener('change', onCommit);
  display.addEventListener('blur', onCommit);
  display.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      display.blur();
    }
  });
}

wirePathReadoutInput('displayMainModelPath', 'ggufPath', { kind: 'gguf' });
wirePathReadoutInput('displayMmprojPath', 'mmprojPath', { kind: 'mmproj' });

$('btnSave').addEventListener('click', saveAll);

wireWebSearchToggles();

async function saveTelegramTokenFromField() {
  const inp = $('telegramBotToken');
  const btn = $('btnTelegramTokenDone');
  if (!inp) return;
  const tok = inp.value.trim();
  if (!tok) {
    setStatus('Paste your bot token first.', 'err');
    return;
  }
  if (lastSettingsForGui?.hasSavedToken) {
    if (!confirmReplaceSavedTelegramToken()) {
      setStatus('Token add cancelled.', '');
      return;
    }
  }
  if (btn) btn.disabled = true;
  setStatus('Adding bot token…', '');
  try {
    const r = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramBotTokenAdd: tok }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    logLine('Telegram bot token added.');
    const botSt = await apiFetch('/api/bot/status').then((r) => r.json()).catch(() => ({}));
    const restartHint =
      botSt?.running && Number(botSt.botCount) !== Number(botSt.configuredBotCount)
        ? ' Stop the bot (sidebar), then start again to run all bots.'
        : '';
    setStatus(`Bot token added.${restartHint}`, restartHint ? 'err' : 'ok');
    await loadSettingsIntoForm();
    await loadOverview();
    await refreshSidebarBotPowerUi();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Telegram token save: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

$('btnTelegramTokenDone')?.addEventListener('click', () => {
  saveTelegramTokenFromField().catch((e) => setStatus(e.message, 'err'));
});

$('telegramBotToken')?.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  saveTelegramTokenFromField().catch((e) => setStatus(e.message, 'err'));
});

async function removeTelegramTokenByIndex(idx) {
  const index = Number(idx);
  if (!Number.isInteger(index) || index < 0) return;
  const label = `Bot ${index + 1}`;
  const sure = window.confirm(
    `Remove ${label} from Telegram setup?\n\n` +
      'This only removes that bot token from settings. The full reset button removes everything.'
  );
  if (!sure) return;
  setStatus(`Removing ${label}…`, '');
  try {
    const r = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramBotTokenRemoveIndex: index }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Remove failed');
    logLine(`${label} token removed.`);
    setStatus(`${label} removed.`, 'ok');
    await loadSettingsIntoForm();
    await loadOverview();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Telegram token remove: ' + e.message);
  }
}

$('telegramTokenList')?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-telegram-token-remove]');
  if (!btn) return;
  const idx = Number(btn.getAttribute('data-telegram-token-remove'));
  removeTelegramTokenByIndex(idx).catch((e) => setStatus(e.message, 'err'));
});

$('btnResetTelegram')?.addEventListener('click', async () => {
  const sure = window.confirm(
    'Reset Telegram setup?\n\n' +
      'This removes saved bot token(s), bot tab names, and bot-specific default personas from data/settings.json, clears Telegram access/identity records in the database, and stops the bot if it is running. Chat history and memory are not removed.\n\n' +
      'If your token is only in .env, edit or remove TELEGRAM_BOT_TOKEN there yourself.'
  );
  if (!sure) return;
  setStatus('Resetting Telegram…', '');
  try {
    const r = await apiFetch('/api/settings/reset-telegram', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Reset failed');
    logLine('Telegram setup reset (saved token cleared, access list cleared).');
    setStatus('Telegram setup reset.', 'ok');
    await loadSettingsIntoForm();
    await loadOverview();
    await loadAccess();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Reset Telegram: ' + e.message);
  }
});

$('inpBotPower')?.addEventListener('change', async () => {
  if (botPowerSwitchSyncing) return;
  const cb = $('inpBotPower');
  const lab = $('lblBotPower');
  if (!cb || cb.disabled) return;
  const wantRun = cb.checked;
  cb.disabled = true;
  lab?.setAttribute('aria-busy', 'true');
  setStatus('', '');
  try {
    if (wantRun) {
      const r = await apiFetch('/api/bot/start', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Start failed');
      logLine('Bot started.');
      setStatus('', '');
    } else {
      const r = await apiFetch('/api/bot/stop', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Stop failed');
      logLine('Bot stopped.');
      setStatus('Stopped.', '');
    }
    await loadOverview();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine(wantRun ? 'Start: ' + e.message : 'Stop: ' + e.message);
    await loadOverview();
  } finally {
    lab?.removeAttribute('aria-busy');
  }
});

$('btnRefreshSouls').addEventListener('click', () => loadDataTab().catch((e) => setStatus(e.message, 'err')));

if ($('btnSaveBotPersona')) {
  $('btnSaveBotPersona').addEventListener('click', async () => {
    const uid = Number($('memSessionSelect')?.value);
    if (!Number.isFinite(uid)) {
      setStatus('Pick a session.', 'err');
      return;
    }
    setStatus('Saving assistant for this session…', '');
    try {
      const botPersona = {
        displayName: $('botDisplayName').value.trim(),
        displayNameMy: $('botDisplayNameMy') ? $('botDisplayNameMy').value.trim() : '',
        gender: $('botGender') ? $('botGender').value.trim() : '',
        style: $('botStyle').value.trim(),
        role: $('botRole').value.trim(),
      };
      const r = await apiFetch(`/api/soul/${uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botPersona,
          profile: { timezone: getMemTimezoneValue() },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      logLine(`Assistant identity saved for session ${uid}.`);
      setStatus('Assistant identity saved for this session.', 'ok');
      await loadSoulForCurrentMemSession();
      await loadSouls();
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Session bot persona: ' + e.message);
    }
  });
}

if ($('btnSaveBotPersonaGlobal')) {
  $('btnSaveBotPersonaGlobal').addEventListener('click', async () => {
    const botId = getSelectedMemoryBotId();
    if (!Number.isFinite(botId)) {
      setStatus('Pick a bot first.', 'err');
      return;
    }
    setStatus('Saving assistant defaults for selected bot…', '');
    try {
      const byBot =
        lastSettingsForGui?.botPersonaByBotId && typeof lastSettingsForGui.botPersonaByBotId === 'object'
          ? { ...lastSettingsForGui.botPersonaByBotId }
          : {};
      byBot[String(botId)] = {
        displayName: $('botDisplayName').value.trim(),
        displayNameMy: $('botDisplayNameMy') ? $('botDisplayNameMy').value.trim() : '',
        gender: $('botGender') ? $('botGender').value.trim() : '',
        style: $('botStyle').value.trim(),
        role: $('botRole').value.trim(),
        addressUserEn: $('memAddressUserEn')?.value?.trim() || '',
        addressUserMy: $('memAddressUserMy')?.value?.trim() || '',
      };
      const body = {
        llmModel: $('llmModel')?.value?.trim() || '',
        botPersonaByBotId: byBot,
      };
      const r = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      logLine(`Assistant defaults saved for bot ${botId}.`);
      setStatus('Bot-specific assistant defaults saved.', 'ok');
      await loadSettingsIntoForm();
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Global bot persona: ' + e.message);
    }
  });
}

if ($('btnCopyBotPersona')) {
  $('btnCopyBotPersona').addEventListener('click', async () => {
    const to = Number($('memSessionSelect')?.value);
    const from = Number($('memCopyBotFromSelect')?.value);
    if (!Number.isFinite(to)) {
      setStatus('Pick a session.', 'err');
      return;
    }
    if (!Number.isFinite(from)) {
      setStatus('Pick a source session for assistant identity.', 'err');
      return;
    }
    if (from === to) {
      setStatus('Source and target session must differ.', 'err');
      return;
    }
    setStatus('Copying assistant identity…', '');
    try {
      const r = await apiFetch('/api/soul/copy-bot-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromUserId: from, toUserId: to }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Copy failed');
      logLine(`Copied assistant identity ${from} → ${to}.`);
      setStatus('Assistant identity copied into current session.', 'ok');
      await loadSoulForCurrentMemSession();
      await loadSouls();
    } catch (e) {
      setStatus(e.message, 'err');
      logLine('Copy bot persona: ' + e.message);
    }
  });
}

$('panel-data')?.addEventListener('click', (ev) => {
  const delRec = ev.target.closest('.btn-delete-record-mem');
  if (delRec) {
    const id = Number(delRec.getAttribute('data-record-id'));
    const uid = Number($('memSessionSelect')?.value);
    if (!Number.isFinite(id) || !Number.isFinite(uid)) return;
    if (!confirm(`Delete saved table row #${id}?`)) return;
    (async () => {
      setStatus('Deleting row…', '');
      try {
        const r = await apiFetch('/api/data/records/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid, id }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Delete failed');
        setStatus('Row deleted.', 'ok');
        await loadRecordsMemTable();
      } catch (e) {
        setStatus(e.message, 'err');
      }
    })();
    return;
  }
  const soulRow = ev.target.closest('.soul-summary-row');
  if (soulRow) {
    toggleSoulDetailRow(soulRow);
    return;
  }
  const tab = ev.target.closest('.mem-stab-link');
  if (!tab || !tab.dataset.memSub) return;
  ev.preventDefault();
  setMemorySubtab(tab.dataset.memSub);
});



if ($('memBotSelect')) {
  $('memBotSelect').addEventListener('change', () => {
    const next = Number($('memBotSelect').value);
    if (!Number.isFinite(next)) return;
    currentMemoryBotId = next;
    try {
      localStorage.setItem(MEMORY_BOT_KEY, String(next));
    } catch {
      /* ignore */
    }
    loadDataTab().catch((e) => setStatus(e.message, 'err'));
  });
}
if ($('btnRenameMemBot')) {
  $('btnRenameMemBot').addEventListener('click', () => {
    const botId = getSelectedMemoryBotId();
    if (!Number.isFinite(botId)) {
      setStatus('Pick a bot first.', 'err');
      return;
    }
    const current = getMemoryBotLabel(botId);
    const next = window.prompt(`Rename label for Bot ${botId}:`, current);
    if (next == null) return;
    saveMemoryBotTabName(botId, next)
      .then(() => loadDataTab())
      .catch((e) => setStatus(e.message, 'err'));
  });
}
for (const tzId of MEM_TIMEZONE_SELECT_IDS) {
  const el = $(tzId);
  if (el) el.addEventListener('change', () => syncMemTimezoneSelects(el));
}
if ($('memSessionSelect')) {
  $('memSessionSelect').addEventListener('change', () => {
    try {
      localStorage.setItem(CHAT_SESSION_STORAGE_KEY, $('memSessionSelect').value);
    } catch {
      /* ignore */
    }
    loadSoulForCurrentMemSession().catch((e) => setStatus(e.message, 'err'));
  });
}
if ($('btnRefreshRecordsMem')) {
  $('btnRefreshRecordsMem').addEventListener('click', () => {
    loadRecordsMemTable().catch((e) => setStatus(e.message, 'err'));
  });
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
          work: $('memWork') ? $('memWork').value.trim() : '',
          gender: $('memGender') ? $('memGender').value.trim() : '',
          age: $('memAge') ? $('memAge').value.trim() : '',
          extra: $('memExtra').value.trim(),
          memorySummary: $('memMemorySummary') ? $('memMemorySummary').value.trim() : '',
          addressUserEn: $('memAddressUserEn') ? $('memAddressUserEn').value.trim() : '',
          addressUserMy: $('memAddressUserMy') ? $('memAddressUserMy').value.trim() : '',
          timezone: getMemTimezoneValue(),
        },
      };
      const r = await apiFetch(`/api/soul/${uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      logLine(`Session memory saved for user ${uid}.`);
      setStatus('Session memory saved.', 'ok');
      await loadSouls();
      await loadMemorySessionsIntoSelects();
      await loadChat().catch(() => {});
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
      const r = await apiFetch(`/api/soul/${uid}/clear`, { method: 'POST' });
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
      'This deletes ALL souls, ALL chat history, ALL pending actions, ALL calendar events, and ALL saved table rows (purchases/medicine).\n\nType DELETE ALL to confirm:'
    );
    if (typed !== 'DELETE ALL') {
      if (typed != null) setStatus('Cancelled.', '');
      return;
    }
    setStatus('Clearing all memory…', '');
    try {
      const r = await apiFetch('/api/memory/clear-all', {
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
      const r = await apiFetch('/api/soul/copy', {
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
$('btnCalPrev')?.addEventListener('click', () => shiftCalendarMonth(-1));
$('btnCalNext')?.addEventListener('click', () => shiftCalendarMonth(1));
$('btnCalToday')?.addEventListener('click', () => jumpCalendarToToday());
$('btnRefreshPending').addEventListener('click', () => loadPending().catch(() => {}));

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
    const r = await apiFetch('/api/data/calendar/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Delete failed');
    logLine(`Calendar event ${id} deleted.`);
    setStatus('Event deleted.', 'ok');
    await loadCalendar();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Calendar delete: ' + e.message);
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

$('panel-pending')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-pending-delete]');
  if (!btn) return;
  const userId = Number(btn.getAttribute('data-pending-delete'));
  if (!Number.isFinite(userId)) return;
  if (!window.confirm(`Remove pending confirmation for user ${userId}?`)) return;
  setStatus('Deleting…', '');
  try {
    const r = await apiFetch('/api/data/pending/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Delete failed');
    logLine(`Pending row for user ${userId} removed.`);
    setStatus('Pending removed.', 'ok');
    await loadPending();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Pending delete: ' + e.message);
  }
});
$('btnInviteUser')?.addEventListener('click', async () => {
  const email = String($('inviteEmail')?.value || '').trim();
  const username = String($('inviteUsername')?.value || '').trim();
  const telegramUserId = String($('inviteTelegramId')?.value || '').trim();
  const notes = String($('inviteNotes')?.value || '').trim();
  if (!email && !username && !telegramUserId) {
    setStatus('Enter a Google email, @username, or Telegram user id.', 'err');
    return;
  }
  setStatus('Adding invite…', '');
  try {
    const r = await apiFetch('/api/admin/allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: email || undefined,
        username: username || undefined,
        telegramUserId: telegramUserId || undefined,
        notes,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Invite failed');
    if ($('inviteEmail')) $('inviteEmail').value = '';
    if ($('inviteUsername')) $('inviteUsername').value = '';
    if ($('inviteTelegramId')) $('inviteTelegramId').value = '';
    if ($('inviteNotes')) $('inviteNotes').value = '';
    setStatus('Invite added.', '');
    await loadAccess();
  } catch (e) {
    setStatus(e.message, 'err');
  }
});

$('btnRefreshAccess').addEventListener('click', () => loadAccess().catch((e) => setStatus(e.message, 'err')));
$('btnClearAccessAll')?.addEventListener('click', async () => {
  const ok1 = window.confirm(
    'Clear all invites?\n\nNo Telegram user will be able to sign in or message the bot until invited again.'
  );
  if (!ok1) return;
  const ok2 = window.confirm('Second confirmation: clear ALL invites now?');
  if (!ok2) return;
  setStatus('Clearing invites…', '');
  try {
    const r = await apiFetch('/api/admin/allowlist/clear-all', { method: 'POST', credentials: 'include' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Clear access data failed');
    logLine('All Telegram access records cleared.');
    setStatus('Access data cleared.', 'ok');
    await loadAccess();
    await loadOverview();
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Clear access data: ' + e.message);
  }
});
for (const id of ['chatLimit']) {
  $(id)?.addEventListener('change', (ev) => {
    const val = String(ev.target?.value || '100');
    syncChatLimitSelects(val);
    loadChat({ forceBottom: true }).catch(() => {});
  });
}
for (const id of ['chatSessionSelect']) {
  $(id)?.addEventListener('change', (ev) => {
    const val = String(ev.target?.value || '');
    localStorage.setItem(CHAT_SESSION_STORAGE_KEY, val);
    updateChatSessionHint(getActiveChatSelect());
    loadChat().catch((e) => setStatus(e.message, 'err'));
  });
}
for (const id of ['btnChatSend', 'btnOverviewChatSend']) {
  $(id)?.addEventListener('click', () => sendChatFromGui().catch(() => {}));
}
for (const [btnId, inputId, pane] of [
  ['btnChatImage', 'chatImageInput', 'chat'],
  ['btnOverviewChatImage', 'overviewChatImageInput', 'overview'],
]) {
  $(btnId)?.addEventListener('click', () => $(inputId)?.click());
  $(inputId)?.addEventListener('change', async (ev) => {
    const file = ev.target?.files?.[0];
    if (!file) return;
    try {
      if (!String(file.type || '').startsWith('image/')) throw new Error('Please select an image file.');
      if (Number(file.size || 0) > MAX_CHAT_IMAGE_BYTES) {
        throw new Error('Image is too large. Please choose a file under 6 MB.');
      }
      const dataUrl = await readFileAsDataUrl(file);
      setPendingChatImageForPane(pane, {
        name: String(file.name || 'image'),
        type: String(file.type || 'image/jpeg'),
        dataUrl,
      });
      setStatus('Image attached. Add optional text and press send.', '');
    } catch (e) {
      setStatus(e.message, 'err');
    } finally {
      ev.target.value = '';
    }
  });
}
for (const id of ['chatInput', 'overviewChatInput']) {
  $(id)?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      sendChatFromGui().catch(() => {});
    }
  });
}
for (const id of ['btnRefreshChat']) {
  $(id)?.addEventListener('click', () => loadChat().catch((e) => setStatus(e.message, 'err')));
}

$('btnClearChatSession')?.addEventListener('click', () => {
  clearChatDataBySessionWithDoubleConfirmation().catch((e) => setStatus(e.message, 'err'));
});
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
    const auth = await apiFetch('/api/auth/me', { credentials: 'include' }).then((res) => res.json());
    if (!auth.authenticated || auth.role !== 'admin') {
      location.href = '/admin-login';
      return;
    }
    initNeuralBackgroundToggle();
    initScrollbarArrowGlow();
    initWindowControls();
    initNeuralBackground();
    initCustomCursor();
    $('btnAdminLogout')?.addEventListener('click', () => logoutAndRedirect('/admin-login'));
    logLine('Console active. Non-routine updates and errors will appear here.');
    await loadSettingsIntoForm();
    await refreshSidebarBotPowerUi();
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
    setInterval(() => {
      refreshSidebarBotPowerUi().catch(() => {});
    }, 5000);
    setInterval(() => {
      refreshConsoleStatusLine().catch(() => {});
    }, 12000);
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
      if (
        document.getElementById('panel-chat')?.classList.contains('active') ||
        document.getElementById('panel-overview')?.classList.contains('active')
      ) {
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
