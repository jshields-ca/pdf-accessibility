'use strict';

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Suppress all output during tests
  ...(process.env.NODE_ENV === 'test' ? { enabled: false } : {}),
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

module.exports = logger;
