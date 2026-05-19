'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { apiFetch } from '@/lib/api.js';

export function PortalShell({ subtitle, navItems, children, footerExtra, userPortal = false }) {
  const pathname = usePathname();

  useEffect(() => {
    if (userPortal) {
      document.body.classList.add('user-portal');
      return () => document.body.classList.remove('user-portal');
    }
    return undefined;
  }, [userPortal]);

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.location.href = userPortal ? '/login' : '/admin-login';
  }

  return (
    <div className="shell">
      <aside className="sidebar">
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
            const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${active ? ' active' : ''}`}
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
          <div className="sidebar-actions">
            {footerExtra}
            <button type="button" className="btn-mini ghost sidebar-logout-btn" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
