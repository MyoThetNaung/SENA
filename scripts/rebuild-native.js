#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

const runtimeArg = args.find((arg) => arg.startsWith('--runtime='));
const runtime = runtimeArg ? runtimeArg.split('=')[1] : 'node';
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, cmdArgs) {
  const quote = (value) =>
    /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const commandLine = [quote(cmd), ...cmdArgs.map(quote)].join(' ');
  execSync(commandLine, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true
  });
}

function exists(relPath) {
  return fs.existsSync(path.join(projectRoot, relPath));
}

function shouldSkip() {
  if (!exists('node_modules/better-sqlite3')) {
    return true;
  }
  if (runtime === 'electron' && !exists('node_modules/electron')) {
    return true;
  }
  return false;
}

function main() {
  if (!exists('package.json')) {
    return;
  }
  if (shouldSkip()) {
    return;
  }

  console.log(`[native] Rebuilding better-sqlite3 for runtime: ${runtime}`);

  if (runtime === 'electron') {
    // npm exec is more reliable than invoking npx directly on some Windows setups.
    run(npmCmd, ['exec', '--', 'electron-rebuild', '-f', '-w', 'better-sqlite3']);
    return;
  }

  run(npmCmd, ['rebuild', 'better-sqlite3', '--build-from-source']);
}

try {
  main();
} catch (error) {
  console.error(`[native] ${error.message}`);
  process.exit(1);
}
