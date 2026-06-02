import { getConfig } from "../config.js";
import { chatWithTools, providerSupportsTools } from "../llm/chatWithTools.js";
import { executeTool, formatToolResultForModel } from "../tools/executor.js";
import { setPending } from "./pending.js";
import { logger } from "../logger.js";
import { buildFilteredAgentTools, buildToolsSystemAppendix } from "./agentTools.js";

export const AGENT_MAX_STEPS = 8;

/**
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.userText
 * @param {() => Promise<object[]>} params.buildMessages
 * @param {number} [params.maxSteps]
 */
export async function runAgent({
  userId,
  userText,
  buildMessages,
  maxSteps = AGENT_MAX_STEPS,
}) {
  if (!providerSupportsTools() || getConfig().agentToolsEnabled === false) {
    return { ok: false, reason: "agent_disabled" };
  }

  const tools = buildFilteredAgentTools();
  const toolsAppendix = buildToolsSystemAppendix();

  let messages = await buildMessages(userId, userText, {
    includeRecords: true,
  });
  const sys = messages.find((m) => m.role === "system");
  if (sys && typeof sys.content === "string") {
    sys.content += toolsAppendix;
  } else {
    messages.unshift({ role: "system", content: toolsAppendix.trim() });
  }

  for (let step = 0; step < maxSteps; step += 1) {
    let completion;
    try {
      completion = await chatWithTools(messages, tools, {
        timeoutMs: 120000,
        soulUserId: userId,
      });
    } catch (e) {
      logger.error(`runAgent chatWithTools: ${e.message}`);
      return {
        ok: false,
        reason: "model_error",
        reply: `Model error: ${e.message}`,
      };
    }

    const assistantMsg = completion.message;
    const toolCalls = assistantMsg.tool_calls;

    if (!toolCalls?.length) {
      const text = String(assistantMsg.content || "").trim();
      return {
        ok: true,
        reply: text || "(empty model response)",
        wantConfirmKeyboard: false,
      };
    }

    messages.push({
      role: "assistant",
      content: assistantMsg.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      const fn = tc.function || {};
      const toolName = fn.name;
      const toolCallId = tc.id || `call_${step}_${toolName}`;

      const result = await executeTool(userId, toolName, fn.arguments, {
        confirmed: false,
        userText,
      });

      if (result.needsConfirmation) {
        await setPending(userId, "tool_call", {
          toolName: result.toolName,
          args: result.args,
          preview: result.preview,
          agentState: {
            messages: JSON.parse(JSON.stringify(messages)),
            toolCallId,
            userText,
          },
        });
        const preview = result.preview || "Confirm this action?";
        return {
          ok: true,
          reply: `${preview}\n\nReply **Yes** to proceed or **No** to cancel.`,
          wantConfirmKeyboard: true,
        };
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: formatToolResultForModel(result),
      });
    }
  }

  return {
    ok: true,
    reply:
      "I reached the maximum number of tool steps for this request. Please try a simpler question or split your request.",
    wantConfirmKeyboard: false,
  };
}

async function resumeAgentAfterTool(userId, payload, toolResult) {
  const agentState = payload?.agentState;
  if (!agentState?.messages?.length || !providerSupportsTools()) {
    return null;
  }

  const tools = buildFilteredAgentTools();
  const messages = JSON.parse(JSON.stringify(agentState.messages));
  const toolCallId = agentState.toolCallId || `call_confirm_${payload.toolName}`;

  messages.push({
    role: "tool",
    tool_call_id: toolCallId,
    content: formatToolResultForModel(toolResult),
  });

  try {
    const completion = await chatWithTools(messages, tools, {
      timeoutMs: 120000,
      soulUserId: userId,
    });
    const text = String(completion.message?.content || "").trim();
    if (text) return text;
  } catch (e) {
    logger.warn(`resumeAgentAfterTool: ${e.message}`);
  }
  return null;
}

/**
 * After user confirms a pending tool_call.
 * @param {number} userId
 * @param {object} payload
 * @param {string} userText
 */
export async function runConfirmedTool(userId, payload, userText = "") {
  const toolName = payload?.toolName;
  const args = payload?.args || {};
  const result = await executeTool(userId, toolName, args, {
    confirmed: true,
    userText: userText || payload?.agentState?.userText || "",
  });
  if (!result.ok) {
    return { reply: result.error || "Tool execution failed." };
  }

  const resumed = await resumeAgentAfterTool(userId, payload, result);
  return { reply: resumed || result.text || "Done." };
}
