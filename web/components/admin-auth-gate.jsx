'use client';

import { useEffect, useState } from 'react';
import { fetchSession } from '@/lib/auth-client';
import { Card, CardContent } from '@/components/ui/card';

export function AdminAuthGate({ children }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchSession();
        if (cancelled) return;
        if (!me.authenticated || me.role !== 'admin') {
          window.location.href = '/admin-login';
          return;
        }
        setReady(true);
      } catch {
        if (!cancelled) window.location.href = '/admin-login';
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardContent className="py-8 text-center text-muted-foreground">Loading…</CardContent>
        </Card>
      </div>
    );
  }

  return children;
}
