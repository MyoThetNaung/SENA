'use client';

import { useEffect, useState } from 'react';
import { initNeuralBackground } from '@/lib/neural-background';
import { initCustomCursor } from '@/lib/custom-cursor';

export function SenaChrome() {
  const [finePointer, setFinePointer] = useState(false);

  useEffect(() => {
    const canvas = document.getElementById('network');
    return initNeuralBackground(canvas);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine)');
    const apply = () => setFinePointer(mq.matches);
    apply();
    if (mq.matches) initCustomCursor();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return (
    <>
      <canvas id="network" aria-hidden="true" />
      {finePointer ? (
        <>
          <div className="cursor" aria-hidden="true" />
          <div className="cursor-ring" aria-hidden="true" />
        </>
      ) : null}
    </>
  );
}
