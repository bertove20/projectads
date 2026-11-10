import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from '../config/env';

/** Structured logging (JSON) dengan redaksi header & field sensitif. */
export function loggerModule(service: string) {
  const env = loadEnv();
  return LoggerModule.forRoot({
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service },
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-access-token"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.template',
        ],
        censor: '[REDACTED]',
      },
      // URL postback masuk mengandung token rahasia; jangan dicatat utuh.
      serializers: {
        req: (req: { method: string; url: string; id: unknown }) => ({
          id: req.id,
          method: req.method,
          url: req.url?.replace(/\/postback\/in\/[^/?]+/, '/postback/in/[TOKEN]').slice(0, 300),
        }),
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/api/v1/health' },
    },
  });
}
