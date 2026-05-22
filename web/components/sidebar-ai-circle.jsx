'use client';

export function SidebarAiCircle({ running = false, visible = true }) {
  const wrapClass = [
    'sidebar-ai-circle-wrap',
    !visible ? 'hidden' : '',
    running ? 'is-running' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapClass} aria-hidden={visible ? 'false' : 'true'}>
      <div className="ai-circle">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id="aiCircleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#60a5fa" />
            </linearGradient>
            <linearGradient id="aiCircleGradAlt" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="50" className="ring-bg" />
          <circle cx="60" cy="60" r="42" className="ring-inner-bg" />
          <circle cx="60" cy="60" r="50" className="ring-active" />
          <circle cx="60" cy="60" r="42" className="ring-active-alt" />
          <circle cx="60" cy="60" r="33" className="ring-scan" />
          <circle cx="60" cy="60" r="6" className="core" />
        </svg>
      </div>
    </div>
  );
}
