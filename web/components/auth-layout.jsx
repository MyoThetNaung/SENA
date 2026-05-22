'use client';

import { useEffect } from 'react';

export function AuthLayout({ title, description, children }) {
  useEffect(() => {
    document.body.classList.add('sena-auth');
    return () => document.body.classList.remove('sena-auth');
  }, []);

  return (
    <div className="sena-auth-shell">
      <div aria-hidden="true" className="sena-auth-overlay" />
      <div className="sena-auth-card">
        <h1 className="sena-auth-title">{title}</h1>
        {description ? <div className="auth-lead">{description}</div> : null}
        <div className="sena-auth-content" suppressHydrationWarning>
          {children}
        </div>
      </div>
    </div>
  );
}
