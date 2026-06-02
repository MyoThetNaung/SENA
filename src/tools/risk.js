/** @readonly */
export const RISK_READ = "read";
/** @readonly */
export const RISK_WRITE = "write";
/** @readonly */
export const RISK_DESTRUCTIVE = "destructive";

/**
 * @param {string} risk
 * @param {{ confirmed?: boolean }} [opts]
 */
export function needsConfirmation(risk, opts = {}) {
  if (opts.confirmed) return false;
  return risk === RISK_WRITE || risk === RISK_DESTRUCTIVE;
}
