'use client';

import { useEffect, useState } from 'react';
import { fetchSession } from '@/lib/auth-client';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const DISABLED_MESSAGE =
  'Your account has been disabled. Please contact your administrator for help.';

export function UserAuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchSession();
        if (cancelled) return;
        if (me.accountDisabled) {
          setDisabled(true);
          return;
        }
        if (!me.authenticated || me.role !== 'user') {
          window.location.href = '/login';
          return;
        }
        setReady(true);
      } catch {
        if (!cancelled) window.location.href = '/login';
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (disabled) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Account disabled</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-muted-foreground">
            <p>{DISABLED_MESSAGE}</p>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                window.location.href = '/login';
              }}
            >
              Back to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
