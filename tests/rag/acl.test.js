import { describe, it, expect } from "vitest";
import { normalizeAclPrincipals, principalsForUser } from "../../src/rag/acl.js";

describe("RAG ACL", () => {
  it("defaults to public when acl omitted", () => {
    const p = normalizeAclPrincipals(undefined);
    expect(p).toEqual([{ principal_type: "public", principal_value: "*" }]);
  });

  it("maps userIds to user principals", () => {
    const p = normalizeAclPrincipals({ userIds: [42, 99] });
    expect(p).toContainEqual({ principal_type: "user", principal_value: "42" });
    expect(p).toContainEqual({ principal_type: "user", principal_value: "99" });
  });

  it("builds retrieval principals for soul user", () => {
    const p = principalsForUser(7);
    expect(p.some((x) => x.principal_type === "user" && x.principal_value === "7")).toBe(true);
    expect(p.some((x) => x.principal_type === "public")).toBe(true);
  });
});
