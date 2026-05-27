/**
 * Require an environment variable. Throws a clear error at startup if missing.
 *
 * Use at module top level in entry points and library modules that depend on
 * env. Fail-fast at boot is preferable to a silent fallback that, e.g., signs
 * JWTs with 'dev-secret' in production.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(
      `Required environment variable "${name}" is not set. ` +
        'Set it in your .env (dev) or service env vars (prod) before starting.',
    )
  }
  return value
}
