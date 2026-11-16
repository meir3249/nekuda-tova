/** Supabase is unreachable, paused, or returned a 5xx. Callers may retry later. */
export class RepositoryUnavailableError extends Error {
  override readonly name = 'RepositoryUnavailableError'
}

/** The request reached Supabase but failed (permissions, constraint, bad request). */
export class RepositoryError extends Error {
  override readonly name = 'RepositoryError'
  readonly code: string | null
  constructor(message: string, code: string | null = null) {
    super(message)
    this.code = code
  }
}

interface SupabaseErrorLike {
  message: string
  code?: string
}

/**
 * Converts a supabase-js `{ error, status }` pair into a typed error.
 * Status 0 (network failure / DNS, e.g. a paused project) and 5xx are "unavailable".
 * Messages never include keys or request bodies.
 */
export function toRepositoryError(error: SupabaseErrorLike, status: number): Error {
  if (status === 0 || status >= 500) {
    return new RepositoryUnavailableError(`Supabase unavailable (status ${status}): ${error.message}`)
  }
  return new RepositoryError(error.message, error.code ?? null)
}
