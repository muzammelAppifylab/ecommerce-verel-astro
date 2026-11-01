/* Radix controls report values, not DOM events. These build a minimal event-like object so the
   design-system signatures (`onChange(e)` with e.target.value / e.target.checked) keep working. */
export function syntheticChange<T extends HTMLElement>(target: Record<string, unknown>): React.ChangeEvent<T> {
  const t = target as unknown as T
  return { target: t, currentTarget: t, type: 'change', preventDefault() {}, stopPropagation() {} } as unknown as React.ChangeEvent<T>
}
