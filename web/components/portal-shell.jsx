'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { activeNavItem, isNavItemActive } from '@/lib/nav-active.js';
import { NeuralBackgroundToggle } from '@/components/neural-background-toggle';
import { UserSidebarBottom } from '@/components/user-sidebar-bottom';

const ScrollIndicator = dynamic(
  () => import('@/components/scroll-indicator').then((m) => m.ScrollIndicator),
  { ssr: false }
);

function currentNavLabel(pathname, navItems) {
  return activeNavItem(pathname, navItems)?.label || 'SENA';
}

export function PortalShell({ subtitle, navItems, children, footerExtra, userPortal = false }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const pageLabel = userPortal ? '' : currentNavLabel(pathname, navItems);

  useEffect(() => {
    if (userPortal) {
      document.body.classList.add('user-portal');
      return () => document.body.classList.remove('user-portal');
    }
    return undefined;
  }, [userPortal]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.location.href = userPortal ? '/login' : '/admin-login';
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className={`shell${menuOpen ? ' portal-menu-open' : ''}`}>
      <header className="portal-mobile-header">
        <button
          type="button"
          className="portal-menu-btn"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="portal-sidebar"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="portal-menu-btn-bar" aria-hidden="true" />
          <span className="portal-menu-btn-bar" aria-hidden="true" />
          <span className="portal-menu-btn-bar" aria-hidden="true" />
        </button>
        <Link href={navItems[0]?.href || '/'} className="portal-mobile-brand" onClick={closeMenu}>
          <img className="portal-mobile-logo" src="/sena-logo.svg" width="36" height="36" alt="" decoding="async" />
          <span className="portal-mobile-brand-name audiowide-regular">SENA</span>
        </Link>
        {userPortal ? (
          <NeuralBackgroundToggle
            id="neuralBgToggleMobileHeader"
            className="portal-mobile-header-neural"
          />
        ) : (
          <span className="portal-mobile-page">{pageLabel}</span>
        )}
      </header>

      <button
        type="button"
        className={`portal-sidebar-backdrop${menuOpen ? ' is-open' : ''}`}
        aria-label="Close menu"
        tabIndex={menuOpen ? 0 : -1}
        onClick={closeMenu}
      />

      <aside id="portal-sidebar" className={`sidebar${menuOpen ? ' is-open' : ''}`}>
        <div className="brand" title="SENA (Smart Engine for Notes & Action) AI Assistant">
          <div className="brand-row">
            <span className="brand-logo-wrap">
              <img className="brand-logo" src="/sena-logo.svg" width="48" height="48" alt="" decoding="async" />
            </span>
            <div className="brand-name audiowide-regular">SENA</div>
          </div>
          <div className="brand-tagline">{subtitle}</div>
        </div>
        <nav className="nav sidebar-nav-panel">
          {navItems.map((item) => {
            const active = isNavItemActive(pathname, item.href, navItems);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${active ? ' active' : ''}`}
                onClick={closeMenu}
              >
                {item.icon ? (
                  <img className="nav-icon" src={item.icon} width="22" height="22" alt="" />
                ) : null}
                <span className="nav-item-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {userPortal ? (
            <UserSidebarBottom onLogout={logout} />
          ) : (
            <div className="sidebar-actions">
              {footerExtra}
              <button type="button" className="btn-mini ghost sidebar-logout-btn" onClick={logout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="main">{children}</main>
      {userPortal ? <ScrollIndicator /> : null}
    </div>
  );
}
