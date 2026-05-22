import crypto from 'crypto';
import { query } from '../db.js';

const STATE_TTL_MINUTES = 15;

function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

/** Persist OAuth state server-side (Safari/mobile often drops the cookie on Google redirect). */
export async function storeGoogleOAuthState(state) {
  const s = String(state ?? '').trim();
  if (!s) return;
  await query(`INSERT INTO google_oauth_states (state_hash) VALUES ($1) ON CONFLICT DO NOTHING`, [
    hashState(s),
  ]);
}

/**
 * @returns {boolean} true if state was valid and consumed (one-time use)
 */
export async function consumeGoogleOAuthState(state) {
  const s = String(state ?? '').trim();
  if (!s) return false;
  const r = await query(
    `DELETE FROM google_oauth_states
     WHERE state_hash = $1
       AND created_at > timezone('utc', now()) - ($2::text || ' minutes')::interval
     RETURNING 1`,
    [hashState(s), String(STATE_TTL_MINUTES)]
  );
  return r.rows.length > 0;
}

export async function pruneGoogleOAuthStates() {
  await query(
    `DELETE FROM google_oauth_states
     WHERE created_at < timezone('utc', now()) - ($1::text || ' hours')::interval`,
    ['24']
  );
}
