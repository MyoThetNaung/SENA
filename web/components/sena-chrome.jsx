'use client';

import { useEffect } from 'react';
import { initNeuralBackground } from '@/lib/neural-background';

export function SenaChrome() {
  useEffect(() => {
    const canvas = document.getElementById('network');
    return initNeuralBackground(canvas);
  }, []);

  return <canvas id="network" aria-hidden="true" />;
}
