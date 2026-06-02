import { getConfig } from "../config.js";
import { embeddingsConfigured } from "../rag/embeddings.js";
import { getToolDefinition } from "./registry.js";
import { RISK_READ } from "./risk.js";
import { hasConnectorCredentials, CONNECTOR_JIRA } from "../connectors/credentials.js";

/**
 * Whether the user may invoke this tool (before confirmation).
 * @param {number} userId
 * @param {string} toolName
 * @param {object} _args
 */
export async function canInvokeTool(userId, toolName, _args = {}) {
  if (!Number.isFinite(Number(userId)))
    return { allowed: false, reason: "Invalid user session." };
  const tool = getToolDefinition(toolName);
  if (!tool) return { allowed: false, reason: `Unknown tool: ${toolName}` };

  if (tool.name === "web_search" && !getConfig().webSearchEnabled) {
    return { allowed: false, reason: "Web search is disabled in settings." };
  }

  if (tool.name === "search_knowledge") {
    if (!getConfig().ragEnabled) {
      return { allowed: false, reason: "Internal knowledge search (RAG) is disabled." };
    }
    if (!embeddingsConfigured()) {
      return {
        allowed: false,
        reason: "Embeddings are not configured for knowledge search.",
      };
    }
  }

  if (tool.name.startsWith("jira_")) {
    if (!(await hasConnectorCredentials(userId, CONNECTOR_JIRA))) {
      return {
        allowed: false,
        reason: "Jira is not connected. Add credentials in the web portal Integrations tab.",
      };
    }
  }

  return { allowed: true, risk: tool.risk || RISK_READ };
}
