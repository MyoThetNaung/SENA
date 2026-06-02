import {
  jiraCreateIssue,
  jiraGetIssue,
  jiraSearchIssues,
  previewJiraCreateIssue,
} from "../../connectors/jira.js";
import { hasConnectorCredentials, CONNECTOR_JIRA } from "../../connectors/credentials.js";

async function ensureJira(userId) {
  const ok = await hasConnectorCredentials(userId, CONNECTOR_JIRA);
  if (!ok) {
    return { ok: false, error: "Jira is not connected. Configure it in the web portal Integrations tab." };
  }
  return { ok: true };
}

export async function handleJiraSearchIssues(userId, args) {
  const gate = await ensureJira(userId);
  if (!gate.ok) return gate;
  try {
    const r = await jiraSearchIssues(userId, { jql: args?.jql, limit: args?.limit });
    return { ok: true, data: r, text: r.text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function handleJiraGetIssue(userId, args) {
  const gate = await ensureJira(userId);
  if (!gate.ok) return gate;
  try {
    const r = await jiraGetIssue(userId, args?.issue_key);
    return { ok: true, data: r, text: r.text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function handleJiraCreateIssue(userId, args) {
  const gate = await ensureJira(userId);
  if (!gate.ok) return gate;
  try {
    const r = await jiraCreateIssue(userId, {
      projectKey: args?.project_key,
      summary: args?.summary,
      description: args?.description,
      issueType: args?.issue_type,
    });
    return { ok: true, data: r, text: r.text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export { previewJiraCreateIssue };
