const $ = (id) => document.getElementById(id);
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

function logLine(line) {
  const el = $('log');
  const t = new Date().toLocaleTimeString();
  if (!el) return;
  el.textContent = `[${t}] ${line}`;
}

function initWindowControls() {
  const controls = window.senaWindowControls;
  if (!controls) return;
  $('winMinimize')?.addEventListener('click', () => controls.minimize());
  $('winMaximize')?.addEventListener('click', () => controls.toggleMaximize());
  $('winClose')?.addEventListener('click', () => controls.close());
}

let lastConsoleStatusSignature = '';
let lastGuiConsoleUserId = 900000001;
const OVERVIEW_CHAT_LIMIT = '50';

async function refreshConsoleStatusLine() {
  try {
    const [botRes, llmRes, settingsRes] = await Promise.all([
      fetch('/api/bot/status'),
      fetch('/api/llm/server-status'),
      fetch('/api/settings'),
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

function updateProviderVisibility() {
  const p = $('llmProvider').value;
  $('wrapOllama').classList.toggle('hidden', p !== 'ollama');
  $('wrapLlama').classList.toggle('hidden', p !== 'llama-server');
  $('wrapOpenAi')?.classList.toggle('hidden', p !== 'openai');
  $('wrapOpenRouter')?.classList.toggle('hidden', p !== 'openrouter');
  $('wrapGemini')?.classList.toggle('hidden', p !== 'gemini');
}

const CHAT_SESSION_STORAGE_KEY = 'guiChatSessionUserId';
/** Pixels from bottom: if user is within this, treat as "following" the thread (auto-refresh scrolls down). */
const CHAT_STICK_BOTTOM_THRESHOLD_PX = 120;
let lastChatLoadedUserId = null;

let syncingWebSearchInputs = false;
let webSearchSaving = false;

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
    const r = await fetch('/api/settings', {
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

function renderTelegramTokenList(maskedTokens) {
  const el = $('telegramTokenList');
  if (!el) return;
  const list = Array.isArray(maskedTokens) ? maskedTokens.filter(Boolean) : [];
  if (!list.length) {
    el.innerHTML = '<span class="hint">No bot tokens connected yet.</span>';
    return;
  }
  el.innerHTML = list
    .map(
      (tok, idx) =>
        `<span class="telegram-token-chip">Bot ${idx + 1}: ${escapeHtml(String(tok))}</span>`
    )
    .join('');
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
  const r = await fetch('/api/settings');
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
  renderTelegramTokenList(s.telegramBotTokensMasked);
  $('ollamaBaseUrl').value = s.ollamaBaseUrl || 'http://127.0.0.1:11434';
  $('llamaServerUrl').value = s.llamaServerUrl || 'http://127.0.0.1:8080';
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
  $('databasePath').value = s.databasePath || '';
  $('databasePathResolved').textContent = s.databasePathResolved || '';
  $('openBrowserGui').checked = Boolean(s.openBrowserGui);
  setWebSearchInputsChecked(Boolean(s.webSearchEnabled));
  $('settingsPath').textContent = s.settingsPath || '';

  const hint = $('tokenHint');
  if (s.hasSavedToken) {
    if (hint)
      hint.textContent =
        `Connected bots: ${Number(s.telegramBotCount || 0)}. Add another token with the check button (requires 2 confirmations).`;
  } else {
    if (hint) hint.textContent = 'Paste token from @BotFather, then click the check to add the first bot.';
  }

  await refreshModelDropdown(String(s.llmModel || '').trim(), { resetSelection: false });

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
  return `?llmProvider=${encodeURIComponent(p)}`;
}

/**
 * @param {string} selected Preferred model id when not resetting (e.g. saved settings).
 * @param {{ resetSelection?: boolean }} [opts] If true, only the placeholder is selected after load.
 * @returns {Promise<boolean>}
 */
async function refreshModelDropdown(selected, opts = {}) {
  const resetSelection = Boolean(opts.resetSelection);
  try {
    const r = await fetch('/api/llm/catalog' + catalogQueryForUiBackend());
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

function formatLlmBackendLabel(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'llama-server') return 'llama.cpp server (OpenAI API)';
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
    cb.checked = running;
    cb.disabled = starting;
    if (starting) lab?.setAttribute('aria-busy', 'true');
    else lab?.removeAttribute('aria-busy');
    if (sub) sub.textContent = running ? 'RUNNING' : starting ? 'Starting…' : 'Stopped';
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
    const st = await (await fetch('/api/bot/status')).json();
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
    const settings = await (await fetch('/api/settings')).json();
    const display = String(settings.botPersona?.displayName || '').trim();
    const nameEl = $('overviewBotName');
    if (nameEl) {
      nameEl.textContent = display || '—';
    }

    const backEl = $('overviewLlmBackend');
    currentProvider = String(settings.llmProvider || '').toLowerCase();
    if (backEl) backEl.textContent = formatLlmBackendLabel(currentProvider);
    const modelEl = $('overviewActiveModel');
    if (modelEl) {
      const m = String(settings.llmModel || '').trim();
      modelEl.textContent = m || '—';
    }
  } catch {
    currentProvider = '';
    const nameEl = $('overviewBotName');
    if (nameEl) nameEl.textContent = '—';
    const backEl = $('overviewLlmBackend');
    if (backEl) backEl.textContent = '—';
    const modelEl = $('overviewActiveModel');
    if (modelEl) modelEl.textContent = '—';
  }

  clearLocalLlmStats();
  const showLocalLlmStats = isLocalLlmProvider(currentProvider);
  setLocalLlmStatsVisible(showLocalLlmStats);
  if (showLocalLlmStats) {
    try {
      const statsRes = await fetch(`/api/stats/llm-usage?provider=${encodeURIComponent(currentProvider)}`);
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
    const st = await (await fetch('/api/bot/status')).json();
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

  try {
    const ss = await (await fetch('/api/llm/server-status')).json();
    const online = Boolean(ss.online);
    const lineEl = $('overviewServerLine');
    const subEl = $('overviewServerDetail');

    if (lineEl) {
      lineEl.textContent = online ? 'Online' : 'Offline';
    }
    if (subEl) {
      subEl.textContent = '';
    }
    if (online) {
      setStatusLed($('overviewServerLed'), 'live');
    } else {
      setStatusLed($('overviewServerLed'), 'idle');
    }
  } catch {
    const lineEl = $('overviewServerLine');
    const subEl = $('overviewServerDetail');
    if (lineEl) lineEl.textContent = '?';
    if (subEl) subEl.textContent = '';
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
  const r = await fetch('/api/data/souls' + q);
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

function renderMemoryBotTabs(bots) {
  const wrap = $('memBotTabs');
  if (!wrap) return;
  wrap.innerHTML = '';
  const list = Array.isArray(bots) ? bots : [];
  if (!list.length) {
    wrap.innerHTML = '<span class="hint">No Telegram bot data yet.</span>';
    currentMemoryBotId = null;
    return;
  }
  for (let idx = 0; idx < list.length; idx += 1) {
    const b = list[idx];
    const botId = Number(b.botId);
    if (!Number.isFinite(botId)) continue;
    const tab = document.createElement('div');
    tab.className = 'mem-bot-tab';
    tab.dataset.botId = String(botId);
    const on = currentMemoryBotId === botId;
    tab.classList.toggle('active', on);
    tab.setAttribute('role', 'button');
    tab.setAttribute('tabindex', '0');
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.innerHTML = `<span>${escapeHtml(getMemoryBotLabel(botId, `Bot ${idx + 1}`))}</span><button type="button" class="mem-bot-tab-edit" data-mem-bot-edit="${botId}" title="Rename tab">✎</button>`;
    wrap.appendChild(tab);
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
  const r = await fetch('/api/settings', {
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
  const r = await fetch('/api/memory/bots');
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
  renderMemoryBotTabs(bots);
}

async function loadMemorySessionsIntoSelects() {
  const botId = getSelectedMemoryBotId();
  const q = botId != null ? `?botId=${encodeURIComponent(String(botId))}` : '';
  const d = await fetch('/api/memory/sessions' + q).then((r) => r.json());
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
    o.textContent = `${s.label} · ${s.userId}`;
    memSel.appendChild(o);
    const c = document.createElement('option');
    c.value = String(s.userId);
    c.textContent = `${s.label} · ${s.userId}`;
    copySel.appendChild(c);
    if (copyBotSel) {
      const b = document.createElement('option');
      b.value = String(s.userId);
      b.textContent = `${s.label} · ${s.userId}`;
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
    return;
  }
  const r = await fetch(`/api/soul/${uid}`);
  const soul = await r.json();
  if (soul.error) throw new Error(soul.error);
  applySoulToMemForm(soul);
  applyBotPersonaFieldsToForm(mergeBotPersonaForMemForm(soul));
}

async function loadDataTab() {
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
  const text = `Active user id: ${uid} — ${opt ? opt.textContent : ''}`;
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
    o.textContent = `${s.label} · ${s.userId}`;
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

async function loadChat(opts = {}) {
  const overviewActive = Boolean(document.getElementById('panel-overview')?.classList.contains('active'));
  const limit = overviewActive ? OVERVIEW_CHAT_LIMIT : $('chatLimit')?.value || '100';
  if (!overviewActive) syncChatLimitSelects(limit);
  const sess = await fetch('/api/chat/sessions').then((r) => r.json());
  if (sess.error) throw new Error(sess.error);
  buildSessionSelect(sess);
  const activeUid = overviewActive ? lastGuiConsoleUserId : Number(getActiveChatSelect()?.value);
  const sessionChanged = lastChatLoadedUserId !== activeUid;
  const forceBottom = Boolean(opts.forceBottom) || sessionChanged;
  localStorage.setItem(CHAT_SESSION_STORAGE_KEY, String(activeUid));
  const q = new URLSearchParams({ limit });
  q.set('userId', String(activeUid));
  const data = await fetch('/api/chat?' + q.toString()).then((r) => r.json());
  if (data.error) throw new Error(data.error);
  renderChatThread(data.messages || [], { forceBottom });
  lastChatLoadedUserId = activeUid;
}

async function sendChatFromGui() {
  const overviewActive = Boolean(document.getElementById('panel-overview')?.classList.contains('active'));
  const input = getActiveChatInputEl();
  const text = (input?.value || '').trim();
  if (!text) return;
  const userId = overviewActive ? lastGuiConsoleUserId : Number(getActiveChatSelect()?.value);
  if (!Number.isFinite(userId)) {
    setStatus('Chat session is unavailable.', 'err');
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
    await loadChat({ forceBottom: true });
  } catch (e) {
    setStatus(e.message, 'err');
    logLine('Chat: ' + e.message);
    await loadChat({ forceBottom: true }).catch(() => {});
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
    const id = Number(e.id);
    return `<tr><td>${escapeHtml(when)}</td><td>${e.user_id}</td><td class="msg">${escapeHtml(e.title)}</td><td class="nowrap"><button type="button" class="btn-mini danger" data-cal-delete="${Number.isFinite(id) ? id : ''}">Delete</button></td></tr>`;
  });
  $('calBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="4" class="hint">No events.</td></tr>';
}

async function loadPending() {
  const r = await fetch('/api/data/pending');
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
    const body = {
      llmProvider: $('llmProvider').value,
      ollamaBaseUrl: $('ollamaBaseUrl').value.trim(),
      llamaServerUrl: $('llamaServerUrl').value.trim(),
      llmModel: $('llmModel').value.trim(),
      guiPort: $('guiPort').value,
      logLevel: $('logLevel').value,
      browserTimeoutMs: $('browserTimeoutMs').value,
      maxBrowsePages: $('maxBrowsePages').value,
      databasePath: $('databasePath').value.trim(),
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
  refreshModelDropdown('', { resetSelection: true }).catch(() => {});
});

$('btnRefreshModels').addEventListener('click', () => {
  const cur = $('llmModel')?.value?.trim() || '';
  refreshModelDropdown(cur, { resetSelection: false });
});

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
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramBotTokenAdd: tok }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    logLine('Telegram bot token added.');
    setStatus('Bot token added.', 'ok');
    await loadSettingsIntoForm();
    await loadOverview();
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

$('btnResetTelegram')?.addEventListener('click', async () => {
  const sure = window.confirm(
    'Reset Telegram setup?\n\n' +
      'This removes saved bot token(s), bot tab names, and bot-specific default personas from data/settings.json, clears Telegram access/identity records in the database, and stops the bot if it is running. Chat history and memory are not removed.\n\n' +
      'If your token is only in .env, edit or remove TELEGRAM_BOT_TOKEN there yourself.'
  );
  if (!sure) return;
  setStatus('Resetting Telegram…', '');
  try {
    const r = await fetch('/api/settings/reset-telegram', { method: 'POST' });
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
      const r = await fetch('/api/bot/start', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Start failed');
      logLine('Bot started.');
      setStatus('', '');
    } else {
      const r = await fetch('/api/bot/stop', { method: 'POST' });
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
      const r = await fetch(`/api/soul/${uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botPersona }),
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
      const r = await fetch('/api/settings', {
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
      const r = await fetch('/api/soul/copy-bot-persona', {
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
  const editBtn = ev.target.closest('[data-mem-bot-edit]');
  if (editBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    const botId = Number(editBtn.getAttribute('data-mem-bot-edit'));
    if (!Number.isFinite(botId)) return;
    const current = getMemoryBotLabel(botId);
    const next = window.prompt(`Rename tab for Bot ${botId}:`, current);
    if (next == null) return;
    saveMemoryBotTabName(botId, next)
      .then(() => loadDataTab())
      .catch((e) => setStatus(e.message, 'err'));
    return;
  }
  const botTab = ev.target.closest('.mem-bot-tab');
  if (botTab && botTab.dataset.botId) {
    ev.preventDefault();
    const next = Number(botTab.dataset.botId);
    if (!Number.isFinite(next) || currentMemoryBotId === next) return;
    currentMemoryBotId = next;
    try {
      localStorage.setItem(MEMORY_BOT_KEY, String(next));
    } catch {
      /* ignore */
    }
    loadDataTab().catch((e) => setStatus(e.message, 'err'));
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

$('panel-data')?.addEventListener('keydown', (ev) => {
  const botTab = ev.target.closest('.mem-bot-tab');
  if (botTab && (ev.key === 'Enter' || ev.key === ' ')) {
    ev.preventDefault();
    const next = Number(botTab.dataset.botId);
    if (!Number.isFinite(next) || currentMemoryBotId === next) return;
    currentMemoryBotId = next;
    try {
      localStorage.setItem(MEMORY_BOT_KEY, String(next));
    } catch {
      /* ignore */
    }
    loadDataTab().catch((e) => setStatus(e.message, 'err'));
    return;
  }
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const soulRow = ev.target.closest('.soul-summary-row');
  if (!soulRow) return;
  ev.preventDefault();
  toggleSoulDetailRow(soulRow);
});

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

$('panel-calendar')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-cal-delete]');
  if (!btn) return;
  const id = Number(btn.getAttribute('data-cal-delete'));
  if (!Number.isFinite(id) || id < 1) return;
  if (!window.confirm('Delete this calendar event?')) return;
  setStatus('Deleting…', '');
  try {
    const r = await fetch('/api/data/calendar/delete', {
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

$('panel-pending')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-pending-delete]');
  if (!btn) return;
  const userId = Number(btn.getAttribute('data-pending-delete'));
  if (!Number.isFinite(userId)) return;
  if (!window.confirm(`Remove pending confirmation for user ${userId}?`)) return;
  setStatus('Deleting…', '');
  try {
    const r = await fetch('/api/data/pending/delete', {
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
$('btnRefreshAccess').addEventListener('click', () => loadAccess().catch((e) => setStatus(e.message, 'err')));
$('btnClearAccessAll')?.addEventListener('click', async () => {
  const ok = window.confirm(
    'Clear all access data?\n\nThis removes all pending, approved, and blocked Telegram access records. New messages will create fresh pending requests.'
  );
  if (!ok) return;
  setStatus('Clearing access data…', '');
  try {
    const r = await fetch('/api/access/clear-all', { method: 'POST' });
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
    initNeuralBackgroundToggle();
    initScrollbarArrowGlow();
    initWindowControls();
    initNeuralBackground();
    initCustomCursor();
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
