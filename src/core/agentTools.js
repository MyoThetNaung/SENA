import { getConfig } from "../config.js";
import { embeddingsConfigured } from "../rag/embeddings.js";
import { listOpenAiTools } from "../tools/registry.js";

/** OpenAI tool list with settings-based filtering (web search, RAG). */
export function buildFilteredAgentTools() {
  const tools = listOpenAiTools();
  const cfg = getConfig();
  if (!cfg.webSearchEnabled) {
    const idx = tools.findIndex((t) => t.function?.name === "web_search");
    if (idx >= 0) tools.splice(idx, 1);
  }
  if (!cfg.ragEnabled || !embeddingsConfigured()) {
    const idx = tools.findIndex((t) => t.function?.name === "search_knowledge");
    if (idx >= 0) tools.splice(idx, 1);
  }
  return tools;
}

function buildToolsSystemAppendix() {
  const lines = [
    "",
    "---",
    "Tools: You have registered tools for calendar, tasks, internal knowledge, and optional web search.",
    '- Use calendar_list_events to read the schedule (today, upcoming, or a specific date).',
    '- Use calendar_add_event only when the user wants to create an event (title + starts_at ISO 8601).',
    '- Use task_list to read open, done, or all tasks.',
    '- Use task_add to create a task (title + optional due_at ISO 8601).',
    '- Use task_complete to mark a task done by id; task_delete removes a task.',
    '- Use search_knowledge for company wikis, policies, runbooks, and ingested internal docs (not live web news).',
    '- Use jira_search_issues / jira_get_issue / jira_create_issue when the user asks about Jira tickets (requires Integrations setup).',
  ];
  if (getConfig().webSearchEnabled) {
    lines.push("- Use web_search when the user needs current public web information.");
  }
  lines.push(
    "- After tool results, answer the user concisely in plain language.",
    "- Do not invent tool results; only state what tools returned.",
    "- Cite internal docs by the bracket numbers returned by search_knowledge when relevant."
  );
  return lines.join("\n");
}

export { buildToolsSystemAppendix };
