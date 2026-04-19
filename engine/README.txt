Place llama.cpp binaries here (e.g. llama-server.exe on Windows).

-------------------------------------------------------------------------------
QUICK FIX if Telegram says "connection refused" on http://127.0.0.1:8080
-------------------------------------------------------------------------------
Something must be listening BEFORE you chat. Pick one:

  A) Control Panel -> Engine -> enable "Auto-start llama-server when the bot starts"
     Put llama-server.exe in the engine folder and a .gguf in models/ whose name matches "Active model".
     Save, Start bot — the app will launch llama-server for you.

  B) Start llama-server manually in another terminal (see below), then Start bot.

  C) Use Ollama: LLM backend = "Ollama", URL http://127.0.0.1:11434 — run the Ollama app first.

-------------------------------------------------------------------------------

Typical workflow (llama.cpp):

1. Put your .gguf file in the project `models` folder (or elsewhere).

2. Start the server in a SEPARATE terminal (leave it running):

     cd engine
     .\llama-server.exe -m ..\models\your-model.gguf --host 127.0.0.1 --port 8080

   Or copy start-llama-server.example.ps1 to start-llama-server.ps1, edit the model path, then:

     .\start-llama-server.ps1

3. In the Control Panel -> Engine & models:
   - LLM backend = llama.cpp server
   - Server URL = http://127.0.0.1:8080 (must match --port)
   - Active model = usually the GGUF file name without .gguf (what the server loaded)

If the server uses another port, change --port and set the same URL in the Control Panel.

Ollama users can ignore this folder and set the backend to Ollama.
