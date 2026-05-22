/**
 * Admin-style custom pointer (dot + ring). Requires `.cursor` and `.cursor-ring` in the DOM.
 * @param {{ sideMenuSelector?: string }} [options]
 */
export function initCustomCursor(options = {}) {
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
    options.sideMenuSelector ??
    '#mainNav .nav-item, .sidebar-nav-panel .nav-item, .sidebar-nav-panel a.nav-item, #mainNav .nav-settings-toggle, #lblBotPower, .bot-power-switch, .neo-toggle, .neo-toggle-container';

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
