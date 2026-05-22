export function SidebarFooter({ running = false }) {
  return (
    <footer className="sidebar-footer" aria-label="Credits">
      <div className="sidebar-footer-graphic" aria-hidden="true">
        <span className="sidebar-footer-glow" />
        <span
          className={`sidebar-footer-ornament${running ? ' running-glow' : ''}`}
          aria-hidden="true"
        />
        <span className="sidebar-footer-glow sidebar-footer-glow--flip" />
      </div>
      <p className="sidebar-footer-tag">
        Powered By <span className="sidebar-footer-brand">SENA</span>
      </p>
    </footer>
  );
}
