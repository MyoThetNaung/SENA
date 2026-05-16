import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(projectRoot);

const { reloadConfig } = await import(path.join(projectRoot, 'src/config.js'));
reloadConfig();

const { startSenaWebServer } = await import(path.join(projectRoot, 'src/web/startServer.js'));
await startSenaWebServer();
