export function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, credentials: opts.credentials ?? 'include' });
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
