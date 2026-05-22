/* global localStorage, requestAnimationFrame, cancelAnimationFrame */

export const NEURAL_BG_STORAGE_KEY = 'sena-neural-bg';

let neuralBackgroundEnabled = true;

export function getNeuralBackgroundEnabled() {
  return neuralBackgroundEnabled;
}

export function setNeuralBackgroundEnabled(enabled) {
  neuralBackgroundEnabled = Boolean(enabled);
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('neural-bg-off', !neuralBackgroundEnabled);
  }
}

/** Animated neural network canvas (matches legacy public/app.js). */
export function initNeuralBackground(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  let nodes = [];
  const NODE_COUNT = 128;
  const MAX_DISTANCE = 170;
  const MOUSE_LINK_DISTANCE = 240;
  let tick = 0;
  let frameId = 0;
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
      frameId = requestAnimationFrame(animate);
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
          drawLink(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y, 1 - dist / MAX_DISTANCE);
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

    frameId = requestAnimationFrame(animate);
  }

  const onPointerMove = (ev) => {
    mouse.x = ev.clientX;
    mouse.y = ev.clientY;
    mouse.active = true;
  };
  const onPointerLeave = () => {
    mouse.active = false;
  };
  const onResize = () => {
    resizeCanvas();
    resetNodes();
  };

  setNeuralBackgroundEnabled(readNeuralBackgroundEnabled());

  resizeCanvas();
  resetNodes();
  animate();
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('resize', onResize);

  return () => {
    neuralBackgroundEnabled = false;
    cancelAnimationFrame(frameId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
  };
}

function readNeuralBackgroundEnabled() {
  const saved = localStorage.getItem(NEURAL_BG_STORAGE_KEY);
  return saved == null ? true : saved === '1';
}
