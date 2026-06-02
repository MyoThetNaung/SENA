import { loadConnectorCredentials, CONNECTOR_JIRA } from "./credentials.js";

function normalizeBaseUrl(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) throw new Error("Jira base URL must start with http:// or https://");
  return s;
}

async function jiraFetch(userId, path, { method = "GET", body } = {}) {
  const creds = await loadConnectorCredentials(userId, CONNECTOR_JIRA);
  if (!creds?.baseUrl || !creds?.email || !creds?.apiToken) {
    throw new Error("Jira is not configured. Add base URL, email, and API token in Integrations.");
  }
  const base = normalizeBaseUrl(creds.baseUrl);
  const auth = Buffer.from(`${String(creds.email).trim()}:${String(creds.apiToken).trim()}`).toString(
    "base64",
  );
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jira HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function jiraSearchIssues(userId, { jql, limit } = {}) {
  const query = String(jql || "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC").trim();
  const max = Math.min(50, Math.max(1, Number(limit) || 10));
  const data = await jiraFetch(userId, "/rest/api/3/search", {
    method: "POST",
    body: {
      jql: query,
      maxResults: max,
      fields: ["summary", "status", "assignee", "updated", "priority"],
    },
  });
  const issues = Array.isArray(data?.issues) ? data.issues : [];
  const rows = issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields?.summary || "",
    status: issue.fields?.status?.name || "",
    priority: issue.fields?.priority?.name || "",
    updated: issue.fields?.updated || "",
  }));
  const text =
    rows.length === 0
      ? "No Jira issues matched."
      : rows
          .map(
            (r) =>
              `• ${r.key}: ${r.summary} [${r.status}${r.priority ? `, ${r.priority}` : ""}]`,
          )
          .join("\n");
  return { issues: rows, text };
}

export async function jiraGetIssue(userId, issueKey) {
  const key = String(issueKey || "").trim().toUpperCase();
  if (!key) throw new Error("issue_key is required.");
  const data = await jiraFetch(
    userId,
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status,assignee,reporter,updated,priority`,
  );
  const f = data?.fields || {};
  const desc =
    typeof f.description === "string"
      ? f.description
      : f.description?.content
        ? JSON.stringify(f.description).slice(0, 2000)
        : "";
  const text = [
    `${data.key}: ${f.summary || "(no summary)"}`,
    `Status: ${f.status?.name || "?"}`,
    f.assignee?.displayName ? `Assignee: ${f.assignee.displayName}` : null,
    f.priority?.name ? `Priority: ${f.priority.name}` : null,
    desc ? `Description: ${desc.slice(0, 1500)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { issue: data, text };
}

export async function jiraCreateIssue(userId, { projectKey, summary, description, issueType } = {}) {
  const project = String(projectKey || "").trim().toUpperCase();
  const title = String(summary || "").trim().slice(0, 500);
  if (!project) throw new Error("project_key is required.");
  if (!title) throw new Error("summary is required.");
  const typeName = String(issueType || "Task").trim() || "Task";
  const body = {
    fields: {
      project: { key: project },
      summary: title,
      issuetype: { name: typeName },
    },
  };
  const desc = String(description || "").trim();
  if (desc) {
    body.fields.description = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: desc.slice(0, 4000) }] }],
    };
  }
  const data = await jiraFetch(userId, "/rest/api/3/issue", { method: "POST", body });
  const key = data?.key || "?";
  return { issueKey: key, text: `Created Jira issue ${key}: "${title}".` };
}

export function previewJiraCreateIssue(args) {
  const project = String(args?.project_key || "?").trim();
  const summary = String(args?.summary || "Issue").trim();
  return `Create Jira issue in ${project}: "${summary}"?`;
}

export async function probeJiraCredentials(userId) {
  await jiraFetch(userId, "/rest/api/3/myself");
  return { ok: true };
}
