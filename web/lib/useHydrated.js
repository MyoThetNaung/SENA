'use client';

import { useEffect, useState } from 'react';

/** True after the client has mounted — use to gate UI that must match SSR HTML. */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
