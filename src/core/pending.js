import { query } from '../db.js';

export async function setPending(userId, kind, payload) {
  await query(
    `INSERT INTO pending_confirm (user_id, kind, payload) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       kind = EXCLUDED.kind,
       payload = EXCLUDED.payload,
       created_at = timezone('utc', now())`,
    [userId, kind, JSON.stringify(payload)]
  );
}

export async function getPending(userId) {
  const r = await query('SELECT kind, payload FROM pending_confirm WHERE user_id = $1', [userId]);
  const row = r.rows[0];
  if (!row) return null;
  try {
    const payload =
      typeof row.payload === 'object' && row.payload !== null ? row.payload : JSON.parse(String(row.payload));
    return { kind: row.kind, payload };
  } catch {
    return null;
  }
}

export async function clearPending(userId) {
  await query('DELETE FROM pending_confirm WHERE user_id = $1', [userId]);
}

export async function listAllPending() {
  const r = await query(`SELECT user_id, kind, payload, created_at FROM pending_confirm ORDER BY user_id`);
  return r.rows.map((row) => {
    let payload = row.payload;
    if (typeof payload === 'object' && payload !== null) {
      /* already parsed */
    } else {
      try {
        payload = JSON.parse(String(row.payload));
      } catch {
        /* keep string */
      }
    }
    return { user_id: row.user_id, kind: row.kind, payload, created_at: row.created_at };
  });
}
