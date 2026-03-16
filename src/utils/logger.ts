import winston from 'winston';
import { config } from './config';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${message}${metaStr}${stack ? `\n${stack}` : ''}`;
  }),
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

export const logger = winston.createLogger({
  level: config.app.logLevel,
  format: config.app.isDevelopment ? devFormat : prodFormat,
  defaultMeta: { service: 'task-orchestration' },
  transports: [
    new winston.transports.Console(),
  ],
});

if (!config.app.isDevelopment) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024,   // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 50 * 1024 * 1024,   // 50 MB
      maxFiles: 10,
      tailable: true,
    }),
  );
}

/**
 * Create a child logger with a fixed context label.
 * Usage: const log = createLogger('JobScheduler');
 *        log.info('Scheduler started', { workerCount: 5 });
 */
export function createLogger(context: string): winston.Logger {
  return logger.child({ context });
}
