import { query } from "../db.js";
import { ensureSoul } from "../memory/soul.js";
import { decryptJson, encryptJson } from "./crypto.js";

export const CONNECTOR_JIRA = "jira";

/**
 * @param {number} userId
 * @param {string} connectorType
 * @param {object} credentials Plain object (never logged)
 */
export async function saveConnectorCredentials(userId, connectorType, credentials) {
  await ensureSoul(userId);
  const type = String(connectorType || "").trim().toLowerCase();
  if (!type) throw new Error("connector_type is required.");
  const enc = encryptJson(credentials);
  await query(
    `INSERT INTO user_connector_credentials (user_id, connector_type, credentials_encrypted, updated_at)
     VALUES ($1, $2, $3, timezone('utc', now()))
     ON CONFLICT (user_id, connector_type) DO UPDATE SET
       credentials_encrypted = EXCLUDED.credentials_encrypted,
       updated_at = timezone('utc', now())`,
    [Number(userId), type, enc],
  );
  return { ok: true, connectorType: type };
}

/**
 * @returns {Promise<object|null>}
 */
export async function loadConnectorCredentials(userId, connectorType) {
  const r = await query(
    `SELECT credentials_encrypted FROM user_connector_credentials
     WHERE user_id = $1 AND connector_type = $2 LIMIT 1`,
    [Number(userId), String(connectorType || "").trim().toLowerCase()],
  );
  const row = r.rows[0];
  if (!row?.credentials_encrypted) return null;
  try {
    return decryptJson(row.credentials_encrypted);
  } catch {
    return null;
  }
}

export async function deleteConnectorCredentials(userId, connectorType) {
  const r = await query(
    `DELETE FROM user_connector_credentials WHERE user_id = $1 AND connector_type = $2`,
    [Number(userId), String(connectorType || "").trim().toLowerCase()],
  );
  return Number(r.rowCount || 0) > 0;
}

export async function listConnectorTypesForUser(userId) {
  const r = await query(
    `SELECT connector_type, updated_at FROM user_connector_credentials
     WHERE user_id = $1 ORDER BY connector_type`,
    [Number(userId)],
  );
  return r.rows.map((row) => ({
    connectorType: row.connector_type,
    updatedAt: row.updated_at,
  }));
}

export async function hasConnectorCredentials(userId, connectorType) {
  const creds = await loadConnectorCredentials(userId, connectorType);
  return creds != null && typeof creds === "object";
}
