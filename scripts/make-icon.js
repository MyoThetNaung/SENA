#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourcePngPath = path.join(projectRoot, 'resources', 'SENA LOGO.png');
const sourceIcoPath = path.join(projectRoot, 'resources', 'SENA LOGO.ico');
const buildDir = path.join(projectRoot, 'build');
const icoPath = path.join(buildDir, 'icon.ico');

async function main() {
  fs.mkdirSync(buildDir, { recursive: true });
  if (fs.existsSync(sourcePngPath)) {
    try {
      const icoBuffer = await pngToIco(sourcePngPath);
      fs.writeFileSync(icoPath, icoBuffer);
      console.log(`[icon] Generated ${icoPath} from ${sourcePngPath}`);
      return;
    } catch (e) {
      console.warn(`[icon] PNG to ICO failed (${e.message}); trying fallback ICO source.`);
    }
  }
  if (fs.existsSync(sourceIcoPath)) {
    fs.copyFileSync(sourceIcoPath, icoPath);
    console.log(`[icon] Copied ${icoPath} from ${sourceIcoPath}`);
    return;
  }
  throw new Error(`Icon source missing: ${sourcePngPath} (or fallback ${sourceIcoPath})`);
}

main().catch((error) => {
  console.error(`[icon] ${error.message}`);
  process.exit(1);
});
