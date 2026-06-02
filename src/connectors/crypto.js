import crypto from "crypto";
import { getConfig } from "../config.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function deriveKey() {
  const secret =
    String(process.env.CONNECTOR_ENCRYPTION_KEY || "").trim() ||
    String(getConfig().databaseUrl || "sena-connector-fallback");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptJson(obj) {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plain = JSON.stringify(obj ?? {});
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptJson(blob) {
  const key = deriveKey();
  const buf = Buffer.from(String(blob || ""), "base64");
  if (buf.length < IV_LEN + 16) throw new Error("Invalid encrypted payload.");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
}
