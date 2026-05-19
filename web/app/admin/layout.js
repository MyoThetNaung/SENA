import { AdminAuthGate } from '@/components/admin-auth-gate';
import { PortalShell } from '@/components/portal-shell';
import { ADMIN_NAV } from '@/lib/admin-nav';

export default function AdminLayout({ children }) {
  return (
    <AdminAuthGate>
      <PortalShell subtitle="Administrator" navItems={ADMIN_NAV}>
        {children}
      </PortalShell>
    </AdminAuthGate>
  );
}
