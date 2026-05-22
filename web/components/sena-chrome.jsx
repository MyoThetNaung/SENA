'use client';

import { useEffect } from 'react';
import { initNeuralBackground } from '@/lib/neural-background';
import { initCustomCursor } from '@/lib/custom-cursor';

export function SenaChrome() {
  useEffect(() => {
    const canvas = document.getElementById('network');
    return initNeuralBackground(canvas);
  }, []);

  useEffect(() => {
    initCustomCursor();
  }, []);

  return (
    <>
      <canvas id="network" aria-hidden="true" />
      <div className="cursor" aria-hidden="true" />
      <div className="cursor-ring" aria-hidden="true" />
    </>
  );
}
