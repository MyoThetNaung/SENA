#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourceIcoPath = path.join(projectRoot, 'resources', 'SENA LOGO.ico');
const buildDir = path.join(projectRoot, 'build');
const icoPath = path.join(buildDir, 'icon.ico');

async function main() {
  if (!fs.existsSync(sourceIcoPath)) {
    throw new Error(`Icon source missing: ${sourceIcoPath}`);
  }

  fs.mkdirSync(buildDir, { recursive: true });
  fs.copyFileSync(sourceIcoPath, icoPath);
  console.log(`[icon] Generated ${icoPath}`);
}

main().catch((error) => {
  console.error(`[icon] ${error.message}`);
  process.exit(1);
});
