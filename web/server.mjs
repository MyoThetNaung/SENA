import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(projectRoot);

const { reloadConfig } = await import(pathToFileURL(path.join(projectRoot, 'src/config.js')));
reloadConfig();

const { startSenaWebServer } = await import(
  pathToFileURL(path.join(projectRoot, 'src/web/startServer.js'))
);
await startSenaWebServer();