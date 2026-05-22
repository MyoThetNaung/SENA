'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { SidebarAiCircle } from '@/components/sidebar-ai-circle';
import { SidebarFooter } from '@/components/sidebar-footer';

export function UserSidebarBottom({ onLogout }) {
  const [status, setStatus] = useState(null);
  const [statusKnown, setStatusKnown] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch('/api/user/bot/status');
      const st = await r.json();
      if (st.error) throw new Error(st.error);
      setStatus(st);
    } catch {
      setStatus(null);
    } finally {
      setStatusKnown(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const running = Boolean(status?.running);

  return (
    <>
      <div className="sidebar-actions">
        <SidebarAiCircle running={running} visible={statusKnown} />
        <button type="button" className="btn-mini ghost sidebar-logout-btn" onClick={onLogout}>
          Sign out
        </button>
      </div>
      <SidebarFooter running={running} />
    </>
  );
}
