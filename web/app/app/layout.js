import { UserAuthGate } from '@/components/user-auth-gate';
import { PortalShell } from '@/components/portal-shell';
import { USER_NAV } from '@/lib/user-nav';

export default function UserAppLayout({ children }) {
  return (
    <UserAuthGate>
      <PortalShell subtitle="My account" navItems={USER_NAV} userPortal>
        {children}
      </PortalShell>
    </UserAuthGate>
  );
}
