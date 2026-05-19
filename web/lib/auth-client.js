import { apiFetch } from './api.js';

const USER_OVERVIEW_PATH = '/app';

export async function fetchSession() {
  const r = await apiFetch('/api/auth/me');
  return r.json();
}

export function redirectForRole(role) {
  if (role === 'user') window.location.replace(USER_OVERVIEW_PATH);
  else if (role === 'admin') window.location.replace('/admin');
  else window.location.replace('/login');
}
