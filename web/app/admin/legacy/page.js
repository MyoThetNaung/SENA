'use client';

import { useEffect } from 'react';

/** Redirect to the legacy static admin UI (still uses styles.css). */
export default function AdminLegacyPage() {
  useEffect(() => {
    window.location.replace('/admin.html');
  }, []);

  return (
    <p className="text-muted-foreground">Opening legacy control panel…</p>
  );
}
