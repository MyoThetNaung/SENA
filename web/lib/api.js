export function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, credentials: opts.credentials ?? 'include' });
}

/** Parse JSON API responses; surface HTML error pages clearly. */
export async function apiJson(url, opts = {}) {
  const r = await apiFetch(url, opts);
  const text = await r.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
      throw new Error(
        r.ok
          ? 'Server returned invalid JSON.'
          : `Request failed (${r.status}). ${snippet.startsWith('<!') ? 'Sign in again or restart the Sena server.' : snippet}`
      );
    }
  }
  if (!r.ok) {
    throw new Error(data.error || data.message || `HTTP ${r.status}`);
  }
  return data;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
