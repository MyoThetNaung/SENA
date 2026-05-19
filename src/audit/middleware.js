import { shouldAuditRequest, logAuditFromRequest } from './auditLog.js';

/** Log audit row when the response finishes (mutations + auth callbacks). */
export function auditMiddleware(req, res, next) {
  if (!shouldAuditRequest(req)) {
    next();
    return;
  }
  res.on('finish', () => {
    void logAuditFromRequest(req, res);
  });
  next();
}
