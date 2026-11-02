import pino from 'pino';

const nodeEnv = process.env.NODE_ENV ?? 'development';
// pino-pretty is a dev dependency: only use it for local development, never in a deployed bundle
// (on Vercel NODE_ENV may be unset, and loading a missing transport crashes the function).
const pretty = nodeEnv === 'development' && !process.env.VERCEL;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
  ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});
