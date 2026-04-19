# SENA (Smart Engine for Notes & Action) AI Assistant

Private assistant that runs on your PC: **Telegram** ↔ **Node.js** ↔ **Ollama** (local GGUF) with **SQLite** memory and calendar, plus **Puppeteer** for controlled web search and summarization.

## Prerequisites

- **Node.js 18+**
- **llama-server** (recommended): `llama-server.exe` in `engine/` and a `.gguf` in `models/` — use **Start server** in the Control Panel, or **Ollama** instead if you prefer
- **Telegram** bot token from [@BotFather](https://t.me/BotFather)
- New chatters are **approved in the Control Panel** (Access tab), unless you set optional legacy `ALLOWED_USER_IDS` in `.env`.

## Setup

1. Clone or copy this project and install dependencies:

```powershell
cd "F:\AI ASSISTANT"
npm install
```

2. If you use **llama-server**, place `llama-server.exe` in `engine/` and a `.gguf` in `models/`, then in the Control Panel click **Save settings** → **Start server**. If you use **Ollama** instead, start it (default API `http://127.0.0.1:11434`).

### Option A — Control Panel (GUI in your browser) — recommended on Windows

```powershell
npm run gui
```

Your browser opens **http://127.0.0.1:3847** (local only). You can set **all main options** there: Telegram, **llama-server** or Ollama, **models folder** (for `.gguf` files), **SQLite path**, logging, web-tool limits, and whether to auto-open the browser. Click **Save settings**, then **Start server** (llama.cpp backend) and **Start bot**. The **Chat session** table shows Telegram conversation history stored locally.

- **GGUF files**: default folder is `models/` (configurable). Ollama still needs a `Modelfile` / `ollama create` step — see `models/README.txt`.
- Change the panel port in the form or set `GUI_PORT` in `.env`; **restart** the app after changing the port.
- Uncheck “Open browser when starting Control Panel” in the GUI, or set `OPEN_BROWSER=0` in `.env`, to skip launching a browser window.

### Option B — `.env` only (headless)

```powershell
copy .env.example .env
```

Set at minimum `TELEGRAM_BOT_TOKEN` and `OLLAMA_MODEL` (or use the Control Panel), then:

```powershell
npm start
```

On first run, SQLite is created at `data/assistant.db` (or `DATABASE_PATH`). You can combine `.env` with the Control Panel: values in `data/settings.json` override env for most Telegram/Ollama fields.

## What each part does

| Path | Role |
|------|------|
| `src/index.js` | Headless entry: DB + Telegram bot + Puppeteer shutdown |
| `src/gui-main.js` | Local web Control Panel + optional browser open |
| `src/gui/server.js` | Express API + static UI (`src/gui/public`) |
| `src/gui/bot-runner.js` | Start/stop Telegram polling from the GUI |
| `src/config.js` | Loads `.env` + `data/settings.json` (settings override env) |
| `models/` | Put `.gguf` weights here (see `models/README.txt`); path is configurable in the Control Panel |
| `src/chat/chatLog.js` | Persists Telegram user/assistant lines to SQLite for the Control Panel |
| `src/logger.js` | Winston console logging |
| `src/db.js` | SQLite file, schema (soul, events, pending confirmations) |
| `src/bot/telegram.js` | Telegram long polling, access gate, inline Yes/No |
| `src/access/telegramAccess.js` | Pending / approved / blocked Telegram users (SQLite) |
| `src/llm/ollama.js` | Ollama `/api/chat`, intent + calendar JSON helpers, summarization; optional streaming API |
| `src/memory/soul.js` | Per-user name, preferences, facts; heuristic “remember / my name is …” |
| `src/calendar/calendar.js` | `add_event`, today’s and upcoming events |
| `src/tools/browser.js` | DuckDuckGo HTML search, open ≤2 result pages, visible text, timeouts |
| `src/core/intent.js` | Keyword hints + LLM fallback for CHAT / SEARCH / CALENDAR |
| `src/core/pending.js` | SQLite-backed confirmation queue |
| `src/core/orchestrator.js` | Routes CHAT / SEARCH / CALENDAR, confirmations, tool execution |

## Behavior

- **Auth**: By default, only users **approved** in the Control Panel (Access tab) may chat. Optional `ALLOWED_USER_IDS` in `.env` / settings still auto-approves those IDs (legacy).
- **Intent**: One short Ollama call classifies **CHAT**, **SEARCH**, or **CALENDAR**.
- **Memory**: Loaded into the system prompt each reply. Quick updates via phrases like `Remember: …`, `My name is …`, `Preferences: …`.
- **Calendar**: Natural language is parsed by the model into JSON (`add` / `today` / `upcoming`). **Adding** an event requires **Yes** (or inline button) after the preview.
- **Web**: **SEARCH** intent stages a web search; you must confirm. Puppeteer opens DuckDuckGo, resolves result links, fetches up to two pages within the timeout, then the model summarizes extracted text.
- **Safety**: No shell commands, no arbitrary filesystem access from the bot code paths shown here.

## Environment variables

See `.env.example` for `OLLAMA_BASE_URL`, `DATABASE_PATH`, `LOG_LEVEL`, `BROWSER_TIMEOUT_MS`, `MAX_BROWSE_PAGES`.

## Using llama.cpp instead of Ollama

Point `OLLAMA_BASE_URL` at a server that exposes an **OpenAI-compatible** or **Ollama-compatible** `/api/chat` endpoint if you use a bridge; otherwise install **Ollama** (recommended for simplicity on Windows).

## Troubleshooting

- **`ETELEGRAM: 404 Not Found` / getMe failed**: Almost always a bad `TELEGRAM_BOT_TOKEN`. Copy the **full** token from @BotFather (no quotes, no spaces). If unsure, use BotFather → `/token` or revoke and issue a new token.
- **`Model error` / connection**: Check Ollama is running and `OLLAMA_MODEL` exists (`ollama list`).
- **Ollama HTTP 404 model not found**: The **Active model** name must match an entry from `ollama list` (not necessarily your `.gguf` file name). Install with `ollama pull some-model`, or for a local GGUF use a `Modelfile` + `ollama create myname -f Modelfile` and set Active model to `myname`.
- **llama-server / `fetch failed` / connection refused**: Start `llama-server` first; in the Control Panel set **llama-server base URL** to match `--host` and `--port` (e.g. `http://127.0.0.1:8080`). Logs now spell out **connection refused** vs generic fetch errors. If `/v1/models` is unsupported, pick the model from the GGUF list or type the id your server expects.
- **Puppeteer / Chromium**: First run may download Chromium; corporate proxies may block it.
- **DuckDuckGo layout changes**: If search breaks, adjust selectors in `src/tools/browser.js`.
- **SQLite locked**: Only one process should open the DB file.

## Scripts

- `npm start` — production-style run
- `npm run dev` — `node --watch` for quick iteration
