/* Islands: `const t = useT(dict, 'cart')` → `t('bag.empty')`, `t('items', { count })`.
   `dict` is the prop the page built with `dictionary(locale, ['cart'])` (./server.ts); no catalog is bundled here.
   `trans(t('consent.body'), { privacy: (text) => <a href="/privacy/">{text}</a> })` replaces i18next's <Trans>. */
import { createElement, Fragment, useMemo, type ReactNode } from 'react'
import { type Dictionary, makeT, richParts, type TFunction, translateValue } from './core'

export function useT(dict: Dictionary, ns: string): TFunction {
  return useMemo(() => makeT(dict, ns), [dict, ns])
}

/** Structured value of a key in an island (lists kept as arrays in the catalogs). */
export function useTValue<T = unknown>(dict: Dictionary, ns: string, key: string): T | undefined {
  return useMemo(() => translateValue<T>(dict, ns, key), [dict, ns, key])
}

/** Render a translated string whose `<tag>text</tag>` parts become elements (unknown tags render as text). */
export function trans(text: string, components: Record<string, (inner: string) => ReactNode>): ReactNode {
  return createElement(
    Fragment,
    null,
    ...richParts(text).map((p, i) =>
      typeof p === 'string' ? p : createElement(Fragment, { key: i }, components[p.tag] ? components[p.tag]!(p.text) : p.text),
    ),
  )
}
