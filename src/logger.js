import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { getConfig, projectRoot } from './config.js';

const { combine, timestamp, printf, colorize } = winston.format;

const lineFormat = printf(({ level, message, timestamp: ts }) => {
  return `${ts} [${level}] ${message}`;
});

function getLogDir() {
  return path.join(projectRoot, 'data', 'logs');
}

const logDir = getLogDir();
fs.mkdirSync(logDir, { recursive: true });

export const logger = winston.createLogger({
  level: getConfig().logLevel,
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), lineFormat),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), lineFormat),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'sena.log'),
      format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), lineFormat),
      options: { flags: 'a' },
    }),
  ],
});

/** Call after reloadConfig() when log level may have changed. */
export function syncLoggerLevel() {
  logger.level = getConfig().logLevel;
}
