'use client';

import { useEffect, useId, useState } from 'react';
import {
  applyNeuralBackgroundEnabled,
  readNeuralBackgroundEnabled,
} from '@/lib/neural-background-toggle.js';

function NeoToggleMarkup({ inputId }) {
  return (
    <>
      <div className="neo-track">
        <div className="neo-background-layer" />
        <div className="neo-grid-layer" />
        <div className="neo-track-highlight" />
      </div>
      <div className="neo-thumb">
        <div className="neo-thumb-ring" />
        <div className="neo-thumb-core">
          <div className="neo-thumb-icon">
            <div className="neo-thumb-wave" />
            <div className="neo-thumb-pulse" />
          </div>
        </div>
      </div>
      <div className="neo-gesture-area" />
      <div className="neo-interaction-feedback">
        <div className="neo-ripple" />
        <div className="neo-progress-arc" />
      </div>
      <div className="neo-status">
        <div className="neo-status-indicator">
          <div className="neo-status-dot" />
          <div className="neo-status-text" />
        </div>
      </div>
    </>
  );
}

/** Animated neural network on/off (same control as admin panel page headers). */
export function NeuralBackgroundToggle({ id: idProp, className = '' }) {
  const autoId = useId();
  const inputId = idProp || `neuralBgToggle${autoId.replace(/:/g, '')}`;
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(readNeuralBackgroundEnabled());
    const sync = () => setEnabled(readNeuralBackgroundEnabled());
    window.addEventListener('sena-neural-bg', sync);
    return () => window.removeEventListener('sena-neural-bg', sync);
  }, []);

  function onChange(ev) {
    const on = Boolean(ev.target.checked);
    setEnabled(on);
    applyNeuralBackgroundEnabled(on);
  }

  return (
    <div
      className={`neo-toggle-container neural-bg-toggle-wrap${className ? ` ${className}` : ''}`}
      title="Animated neural background"
    >
      <input
        className="neo-toggle-input neural-bg-toggle"
        id={inputId}
        type="checkbox"
        aria-label="Neural background"
        checked={enabled}
        onChange={onChange}
      />
      <label className="neo-toggle" htmlFor={inputId}>
        <NeoToggleMarkup />
      </label>
    </div>
  );
}
