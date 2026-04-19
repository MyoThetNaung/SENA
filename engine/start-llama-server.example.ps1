# Copy to start-llama-server.ps1, edit MODEL and paths, then run BEFORE npm run gui / the Telegram bot.
# Requires: llama-server.exe next to this script (or set $LlamaServer path).

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LlamaServer = Join-Path $PSScriptRoot "llama-server.exe"
$Model = Join-Path $Root "models\YOUR_MODEL.gguf"   # <-- change file name
$HostAddr = "127.0.0.1"
$Port = 8080

if (-not (Test-Path $LlamaServer)) {
  Write-Host "Missing: $LlamaServer"
  Write-Host "Download a llama.cpp release and place llama-server.exe in the engine folder."
  exit 1
}
if (-not (Test-Path $Model)) {
  Write-Host "Edit this script: model not found at $Model"
  exit 1
}

Write-Host "Starting llama-server on http://${HostAddr}:${Port} ..."
& $LlamaServer -m $Model --host $HostAddr --port $Port
