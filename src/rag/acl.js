/**
 * Normalize ingest ACL into principal rows.
 * @param {object} [acl]
 * @returns {{ principal_type: string, principal_value: string }[]}
 */
export function normalizeAclPrincipals(acl) {
  if (!acl || typeof acl !== "object") {
    return [{ principal_type: "public", principal_value: "*" }];
  }
  if (acl.public === true) {
    return [{ principal_type: "public", principal_value: "*" }];
  }
  const out = [];
  const principals = Array.isArray(acl.principals) ? acl.principals : [];
  for (const p of principals) {
    const t = String(p?.type || p?.principal_type || "")
      .trim()
      .toLowerCase();
    const v = String(p?.value || p?.principal_value || "").trim();
    if (!t || !v) continue;
    out.push({ principal_type: t, principal_value: v });
  }
  const userIds = Array.isArray(acl.userIds) ? acl.userIds : [];
  for (const uid of userIds) {
    const n = Number(uid);
    if (Number.isFinite(n) && n > 0) {
      out.push({
        principal_type: "user",
        principal_value: String(Math.floor(n)),
      });
    }
  }
  if (!out.length) {
    return [{ principal_type: "public", principal_value: "*" }];
  }
  const seen = new Set();
  return out.filter((p) => {
    const k = `${p.principal_type}:${p.principal_value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Principals used when retrieving knowledge for a soul user.
 * @param {number} userId
 */
export function principalsForUser(userId) {
  const uid = Math.floor(Number(userId));
  const list = [
    { principal_type: "public", principal_value: "*" },
    { principal_type: "user", principal_value: String(uid) },
  ];
  return list;
}

/** SQL fragment: OR (principal_type = $n AND principal_value = $m) ... */
export function buildPrincipalMatchSql(principals, startParamIndex = 2) {
  const clauses = [];
  const params = [];
  let i = startParamIndex;
  for (const p of principals) {
    clauses.push(
      `(a.principal_type = $${i} AND a.principal_value = $${i + 1})`,
    );
    params.push(p.principal_type, p.principal_value);
    i += 2;
  }
  return {
    sql: clauses.length ? clauses.join(" OR ") : "FALSE",
    params,
    nextIndex: i,
  };
}
