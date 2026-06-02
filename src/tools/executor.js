import { logger } from "../logger.js";
import { getToolDefinition } from "./registry.js";
import { needsConfirmation } from "./risk.js";
import { canInvokeTool } from "./policy.js";
import {
  handleCalendarAddEvent,
  handleCalendarListEvents,
  previewCalendarAddEvent,
} from "./handlers/calendarTools.js";
import { handleWebSearch, previewWebSearch } from "./handlers/webSearchTool.js";
import { handleSearchKnowledge } from "./handlers/knowledgeTool.js";
import {
  handleTaskAdd,
  handleTaskComplete,
  handleTaskDelete,
  handleTaskList,
  previewTaskAdd,
  previewTaskDelete,
} from "./handlers/taskTools.js";
import {
  handleJiraCreateIssue,
  handleJiraGetIssue,
  handleJiraSearchIssues,
  previewJiraCreateIssue,
} from "./handlers/jiraTools.js";

/**
 * @typedef {object} ToolExecutionResult
 * @property {boolean} ok
 * @property {object} [data]
 * @property {string} [error]
 * @property {boolean} [needsConfirmation]
 * @property {string} [preview]
 * @property {string} [toolName]
 * @property {object} [args]
 */

function parseToolArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`Invalid tool arguments JSON: ${e.message}`);
  }
}

function buildPreview(toolName, args) {
  if (toolName === "calendar_add_event") return previewCalendarAddEvent(args);
  if (toolName === "web_search") return previewWebSearch(args);
  if (toolName === "task_add") return previewTaskAdd(args);
  if (toolName === "task_delete") return previewTaskDelete(args);
  if (toolName === "jira_create_issue") return previewJiraCreateIssue(args);
  return `Run ${toolName}?`;
}

/**
 * @param {number} userId
 * @param {string} toolName
 * @param {string|object} rawArgs
 * @param {{ confirmed?: boolean, userText?: string }} [opts]
 * @returns {Promise<ToolExecutionResult>}
 */
export async function executeTool(userId, toolName, rawArgs, opts = {}) {
  const name = String(toolName || "").trim();
  const tool = getToolDefinition(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

  const policy = await canInvokeTool(userId, name);
  if (!policy.allowed)
    return { ok: false, error: policy.reason || "Tool not allowed." };

  let args;
  try {
    args = parseToolArgs(rawArgs);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  if (needsConfirmation(tool.risk, opts) && name !== "task_complete") {
    return {
      ok: false,
      needsConfirmation: true,
      preview: buildPreview(name, args),
      toolName: name,
      args,
    };
  }

  try {
    if (name === "calendar_list_events") {
      const r = await handleCalendarListEvents(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "calendar_add_event") {
      const r = await handleCalendarAddEvent(userId, args, opts.userText || "");
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "web_search") {
      const r = await handleWebSearch(args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "search_knowledge") {
      const r = await handleSearchKnowledge(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "task_list") {
      const r = await handleTaskList(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "task_add") {
      const r = await handleTaskAdd(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "task_complete") {
      const r = await handleTaskComplete(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "task_delete") {
      const r = await handleTaskDelete(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "jira_search_issues") {
      const r = await handleJiraSearchIssues(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "jira_get_issue") {
      const r = await handleJiraGetIssue(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    if (name === "jira_create_issue") {
      const r = await handleJiraCreateIssue(userId, args);
      if (!r.ok) return r;
      return { ok: true, data: r.data, text: r.data.text };
    }
    return { ok: false, error: `Tool handler not implemented: ${name}` };
  } catch (e) {
    logger.error(`executeTool ${name}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/** Format tool result for the LLM tool message channel. */
export function formatToolResultForModel(result) {
  if (result.needsConfirmation) {
    return JSON.stringify({
      status: "pending_confirmation",
      preview: result.preview,
    });
  }
  if (!result.ok) {
    return JSON.stringify({
      status: "error",
      error: result.error || "Tool failed",
    });
  }
  const payload = {
    status: "ok",
    ...(result.text != null ? { text: result.text } : {}),
    ...(result.data != null ? { data: result.data } : {}),
  };
  return JSON.stringify(payload);
}
