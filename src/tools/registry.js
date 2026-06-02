import { RISK_READ, RISK_WRITE } from "./risk.js";

/**
 * @typedef {object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {'read'|'write'|'destructive'} risk
 * @property {object} parameters JSON Schema object
 */

/** @type {ToolDefinition[]} */
const TOOLS = [
  {
    name: "calendar_list_events",
    description:
      'List the user calendar events. Use view "today" for today only, "upcoming" for future events, or "date" with a YYYY-MM-DD date for a specific day.',
    risk: RISK_READ,
    parameters: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["today", "upcoming", "date"],
          description: "Which calendar slice to return.",
        },
        date: {
          type: "string",
          description:
            'Required when view is "date": local calendar day as YYYY-MM-DD.',
        },
        limit: {
          type: "integer",
          description: "Max rows for upcoming view (default 10).",
        },
      },
      required: ["view"],
    },
  },
  {
    name: "calendar_add_event",
    description:
      "Add a new calendar event for the user. Requires a title and starts_at as ISO 8601 (include timezone offset when possible).",
    risk: RISK_WRITE,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title." },
        starts_at: {
          type: "string",
          description: "Event start time as ISO 8601 datetime.",
        },
      },
      required: ["title", "starts_at"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the public web (DuckDuckGo) and return a summarized answer for the query. Use when the user needs current or factual information from the internet.",
    risk: RISK_WRITE,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "Search the organization's internal knowledge base (wikis, Confluence exports, ingested docs) respecting the user's access. Use for company policies, runbooks, internal procedures, and documented facts — not for live web news.",
    risk: RISK_READ,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query for internal documents.",
        },
        limit: {
          type: "integer",
          description: "Max excerpts to return (default from settings, usually 8).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "task_list",
    description:
      'List the user tasks. Use status "open" (default), "done", or "all".',
    risk: RISK_READ,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "done", "all"],
          description: "Which tasks to include.",
        },
        limit: {
          type: "integer",
          description: "Max rows (default 30).",
        },
      },
    },
  },
  {
    name: "task_add",
    description:
      "Add a personal task for the user. Requires a title; optional due_at as ISO 8601 and priority (low, normal, high).",
    risk: RISK_WRITE,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title." },
        due_at: {
          type: "string",
          description: "Optional due datetime as ISO 8601.",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "Task priority (default normal).",
        },
        notes: { type: "string", description: "Optional notes." },
      },
      required: ["title"],
    },
  },
  {
    name: "task_complete",
    description: "Mark a task as done by task_id.",
    risk: RISK_WRITE,
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "integer", description: "Task id from task_list." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "task_delete",
    description: "Delete a task by task_id.",
    risk: RISK_WRITE,
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "integer", description: "Task id from task_list." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "jira_search_issues",
    description:
      "Search Jira issues with JQL (Jira Query Language). Use when the user asks about tickets, bugs, or work items in Jira.",
    risk: RISK_READ,
    parameters: {
      type: "object",
      properties: {
        jql: {
          type: "string",
          description: "JQL query, e.g. assignee = currentUser() AND status != Done",
        },
        limit: { type: "integer", description: "Max issues (default 10)." },
      },
    },
  },
  {
    name: "jira_get_issue",
    description: "Fetch one Jira issue by key (e.g. PROJ-123).",
    risk: RISK_READ,
    parameters: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "Issue key like PROJ-123." },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_create_issue",
    description:
      "Create a Jira issue. Requires project_key and summary; optional description and issue_type (default Task).",
    risk: RISK_WRITE,
    parameters: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Project key, e.g. PROJ." },
        summary: { type: "string", description: "Issue title." },
        description: { type: "string", description: "Optional description." },
        issue_type: { type: "string", description: "Issue type name (default Task)." },
      },
      required: ["project_key", "summary"],
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function listToolDefinitions() {
  return [...TOOLS];
}

/** @param {string} name */
export function getToolDefinition(name) {
  return BY_NAME.get(String(name || "").trim()) || null;
}

/** OpenAI-compatible tool list for chat completions. */
export function listOpenAiTools() {
  return TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
