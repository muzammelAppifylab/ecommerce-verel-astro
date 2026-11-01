/* Domain errors thrown by the shared libraries (port of VAREL worker/lib/errors.ts). Routes let them bubble:
   the app's error handler (src/server/app.ts, F3) turns an HttpError into the error body with its status, code,
   message and field errors (`422 fields` land on their form fields, AGENTS.md). */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const isHttpError = (e: unknown): e is HttpError =>
  e instanceof HttpError ||
  (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'HttpError' && typeof (e as { status?: unknown }).status === 'number')

export const notFound = (message = 'We cannot find what you are looking for') => new HttpError(404, 'NOT_FOUND', message)

export const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue')

export const forbidden = (message = 'You do not have access to this') => new HttpError(403, 'FORBIDDEN', message)

export const conflict = (code: string, message: string, fields?: Record<string, string>) => new HttpError(409, code, message, fields)

export const invalid = (fields: Record<string, string>, message = 'Check the highlighted fields') =>
  new HttpError(422, 'VALIDATION_ERROR', message, fields)

/** VAREL's body of every error response: { error: { code, message, fields? } }. */
export const errorBody = (e: HttpError) => ({
  error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) },
})
