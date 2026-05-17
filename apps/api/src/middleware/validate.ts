import type { Context, MiddlewareHandler, Env } from 'hono'
import type { ZodSchema, ZodIssue, ZodError } from 'zod'

/** Shape stored in Context variables by the validation middleware. */
export type ValidatedBody<T> = T
export type ValidatedQuery<T> = T

/** Env extension that makes validated data available in a typed Context. */
export type WithValidation<TBody = unknown, TQuery = unknown> = {
  Variables: {
    validatedBody: TBody
    validatedQuery: TQuery
  }
}

/**
 * Zod request body validation middleware for Hono.
 * Parses JSON body, validates against schema, stores result in c.set('validatedBody').
 * Returns 400 with structured error details on validation failure.
 */
export function validateBody<T, E extends Env = Env>(
  schema: ZodSchema<T>,
): MiddlewareHandler<E> {
  return async (c: Context<E>, next) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400)
    }

    const result = schema.safeParse(body)
    if (!result.success) {
      const zodError = result.error as ZodError
      return c.json(
        {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: zodError.issues.map((issue: ZodIssue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      )
    }

    // Store in the context variable map — cast required because Hono's
    // generic Variables system cannot be threaded through MiddlewareHandler
    // without fully typed Env at the call site.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as Context<any>).set('validatedBody', result.data)
    await next()
  }
}

/**
 * Validates query parameters against a Zod schema.
 * Attaches validated query to c.set('validatedQuery').
 */
export function validateQuery<T, E extends Env = Env>(
  schema: ZodSchema<T>,
): MiddlewareHandler<E> {
  return async (c: Context<E>, next) => {
    const queryObj = Object.fromEntries(
      Object.entries(c.req.query()).filter(([, v]) => v !== undefined),
    )

    const result = schema.safeParse(queryObj)
    if (!result.success) {
      const zodError = result.error as ZodError
      return c.json(
        {
          error: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          details: zodError.issues.map((issue: ZodIssue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as Context<any>).set('validatedQuery', result.data)
    await next()
  }
}
