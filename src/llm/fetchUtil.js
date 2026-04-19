/**
 * Turn undici/fetch failures into actionable messages (Node often reports only "fetch failed").
 */
export function explainFetchError(err, url, label = 'LLM') {
  if (err?.name === 'AggregateError' && Array.isArray(err?.errors) && err.errors[0]) {
    return explainFetchError(err.errors[0], url, label);
  }

  const name = err?.name;
  const msg = String(err?.message || err || '');
  const cause = err?.cause;
  const code = cause?.code || err?.code || cause?.errno;

  if (name === 'AbortError' || /aborted/i.test(msg)) {
    return `${label}: timed out or aborted — ${url}`;
  }
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    return `${label}: connection refused — nothing listening at ${url}. Start llama-server (or Ollama) and check the URL/port.`;
  }
  if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND')) {
    return `${label}: host not found — ${url}`;
  }
  if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT')) {
    return `${label}: network timeout — ${url}`;
  }
  if ((msg === 'fetch failed' || msg.includes('fetch failed')) && cause) {
    const inner = explainFetchError(cause, url, label);
    if (!inner.includes('fetch failed')) return inner;
    return `${label}: ${cause.message || cause} (${url})`;
  }
  return `${label}: ${msg} (${url})`;
}
