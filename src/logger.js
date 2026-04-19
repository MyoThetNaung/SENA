import winston from 'winston';
import { getConfig } from './config.js';

const { combine, timestamp, printf, colorize } = winston.format;

const lineFormat = printf(({ level, message, timestamp: ts }) => {
  return `${ts} [${level}] ${message}`;
});

export const logger = winston.createLogger({
  level: getConfig().logLevel,
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), lineFormat),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), lineFormat),
    }),
  ],
});

/** Call after reloadConfig() when log level may have changed. */
export function syncLoggerLevel() {
  logger.level = getConfig().logLevel;
}
