/* global localStorage, document, window */

import { NEURAL_BG_STORAGE_KEY, setNeuralBackgroundEnabled } from './neural-background.js';

export { NEURAL_BG_STORAGE_KEY };

export function readNeuralBackgroundEnabled() {
  const saved = localStorage.getItem(NEURAL_BG_STORAGE_KEY);
  return saved == null ? true : saved === '1';
}

export function applyNeuralBackgroundEnabled(enabled) {
  const on = Boolean(enabled);
  setNeuralBackgroundEnabled(on);
  localStorage.setItem(NEURAL_BG_STORAGE_KEY, on ? '1' : '0');
  document.querySelectorAll('.neural-bg-toggle').forEach((input) => {
    input.checked = on;
  });
  window.dispatchEvent(new CustomEvent('sena-neural-bg', { detail: { enabled: on } }));
}

/** Wire all `.neural-bg-toggle` checkboxes (legacy static HTML). */
export function initNeuralBackgroundToggle() {
  applyNeuralBackgroundEnabled(readNeuralBackgroundEnabled());
  document.querySelectorAll('.neural-bg-toggle').forEach((input) => {
    if (input.dataset.neuralToggleBound === '1') return;
    input.dataset.neuralToggleBound = '1';
    input.addEventListener('change', () => {
      applyNeuralBackgroundEnabled(Boolean(input.checked));
    });
  });
}
