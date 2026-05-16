#!/usr/bin/env node
/**
 * Previously rebuilt native modules. The app now uses PostgreSQL (pg, pure JS).
 * This script remains as a no-op so existing npm lifecycle hooks keep working.
 */
function main() {
  console.log('[native] Skipping native rebuild (PostgreSQL driver has no native rebuild step).');
}

try {
  main();
} catch (error) {
  console.error(`[native] ${error.message}`);
  process.exit(1);
}
