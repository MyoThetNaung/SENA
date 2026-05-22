'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { initScrollIndicator } from '@/lib/scroll-indicator.js';

const ARROW_COUNT = 20;

/** Right-edge chevron scroll rail (same as admin control panel). */
export function ScrollIndicator() {
  const pathname = usePathname();

  useEffect(() => {
    let cleanup = () => {};
    const t = window.setTimeout(() => {
      cleanup = initScrollIndicator();
    }, 0);
    return () => {
      window.clearTimeout(t);
      cleanup();
    };
  }, [pathname]);

  return (
    <div className="scroll-indicator" id="scrollIndicator" aria-hidden="true">
      {Array.from({ length: ARROW_COUNT }, (_, i) => (
        <div key={i} className="arrow" />
      ))}
    </div>
  );
}
