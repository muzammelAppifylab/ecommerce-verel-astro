import { useCallback, useState } from 'react'
import type { Problems } from './rules'

/**
 * Field errors for the account forms (AGENTS.md "Fields"): a client problem shows on blur or after a submit, then
 * follows the value live; a server message (`422 fields`) shows on its field until that field changes.
 * `problems` are translation keys computed from the current values; `translate(key, field)` turns one into words.
 */
export function useFormErrors<F extends string>(problems: Problems<F>, translate: (key: string, field: F) => string) {
  const [touched, setTouched] = useState<Partial<Record<F, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [server, setServerFields] = useState<Partial<Record<F, string>>>({})

  const error = (k: F): string | undefined => {
    if (server[k]) return server[k]
    const key = problems[k]
    return key && (submitted || touched[k]) ? translate(key, k) : undefined
  }

  const blur = (k: F) => () => setTouched((t) => (t[k] ? t : { ...t, [k]: true }))

  const changed = useCallback((k: F) => {
    setServerFields((s) => {
      if (!s[k]) return s
      const next = { ...s }
      delete next[k]
      return next
    })
  }, [])

  /** Marks the form submitted; true when nothing is wrong on the client. */
  const submit = () => {
    setSubmitted(true)
    return Object.values(problems).every((v) => !v)
  }

  /** Server field errors (`ApiError.fields`), only the fields this form has. */
  const setServer = (fields: Record<string, string> | undefined, known: readonly F[]): boolean => {
    const mine: Partial<Record<F, string>> = {}
    for (const k of known) if (fields?.[k]) mine[k] = fields[k]
    setServerFields(mine)
    return Object.keys(mine).length > 0
  }

  const reset = useCallback(() => {
    setTouched({})
    setSubmitted(false)
    setServerFields({})
  }, [])

  return { error, blur, changed, submit, setServer, reset }
}

/** Focus the field with this id (after a refused submit). */
export function focusField(id: string | undefined): void {
  if (!id) return
  requestAnimationFrame(() => document.getElementById(id)?.focus())
}

/** True when an error carries a server message for one of these fields (it is shown on the field, not in the
    form's status line). */
export function hasFieldError(err: unknown, fields: readonly string[]): boolean {
  const f = (err as { fields?: Record<string, string> } | null)?.fields
  return !!f && fields.some((k) => !!f[k])
}
