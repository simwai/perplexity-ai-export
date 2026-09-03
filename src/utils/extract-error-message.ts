// why: the codebase has 25+ sites repeating `error instanceof Error ? error.message : String(error)`;
// centralising the narrowing removes the S4 duplication and gives the rest of the system one
// consistent H7 / S7 path from unknown to a user-visible string.

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}
