import pino from 'pino'

export type Logger = pino.Logger

/**
 * Create a tagged logger for a service. The `service` tag appears on every log line.
 * In dev (NODE_ENV !== 'production'), pretty-prints. In prod, structured JSON.
 */
export function createLogger(service: string): Logger {
  const isProd = process.env['NODE_ENV'] === 'production'
  return pino({
    name: service,
    level: process.env['LOG_LEVEL'] ?? (isProd ? 'info' : 'debug'),
    ...(isProd
      ? {}
      : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  })
}
