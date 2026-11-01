/*
 * Translated words for storefront islands, without i18next.
 *
 * Pages translate on the server and hand each island the namespaces it needs (`dicts`, plain JSON from
 * src/locales/<locale>/<ns>.json, see src/components/layout/dictionaries.ts). The island wraps its tree in
 * <TextProvider> and components read words with useText('layout')('header.search'). Keys follow VAREL's
 * catalogs and i18next conventions: dotted paths, `{{var}}` interpolation, `_one` / `_other` plurals on `count`.
 * Without a provider (or for a key a catalog lacks) the English source is used, so nothing ever reads blank.
 */
import {createContext, type ReactNode, useContext, useMemo} from 'react';

import {EN_FALLBACK} from './text-en';

/** A namespace catalog: nested JSON objects of strings. */
export type Dict = {[key: string]: string | Dict};
/** Catalogs by namespace: {layout: {...}, common: {...}}. */
export type Dicts = Record<string, Dict>;
export type TextVars = Record<string, string | number | null | undefined>;
export type Translate = (key: string, vars?: TextVars) => string;

interface TextContextValue {
  locale: string;
  dicts: Dicts;
}

const TextContext = createContext<TextContextValue>({locale: 'en', dicts: EN_FALLBACK});

const lookup = (dict: Dict | undefined, key: string): string | undefined => {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
};

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralOf(locale: string, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/** `{{name}}` → vars.name (missing vars stay empty). */
export const interpolate = (text: string, vars?: TextVars) =>
  vars ? text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => String(vars[name] ?? '')) : text;

/** Translate one key of one namespace: the page's catalog first, then English, then the key itself. */
export function translate(dicts: Dicts, locale: string, ns: string, key: string, vars?: TextVars): string {
  const candidates =
    vars && typeof vars.count === 'number' ? [`${key}_${pluralOf(locale, vars.count)}`, `${key}_other`, key] : [key];
  for (const dict of [dicts[ns], EN_FALLBACK[ns]]) {
    for (const k of candidates) {
      const hit = lookup(dict, k);
      if (hit !== undefined) return interpolate(hit, vars);
    }
  }
  return key;
}

/** Merge page catalogs over the English fallback, namespace by namespace (deep). */
export function mergeDicts(base: Dicts, over: Dicts | undefined): Dicts {
  if (!over) return base;
  const deep = (a: Dict, b: Dict): Dict => {
    const out: Dict = {...a};
    for (const [k, v] of Object.entries(b)) {
      const prev = out[k];
      out[k] = typeof v === 'object' && v && typeof prev === 'object' && prev ? deep(prev, v) : v;
    }
    return out;
  };
  const out: Dicts = {...base};
  for (const [ns, dict] of Object.entries(over)) out[ns] = out[ns] ? deep(out[ns], dict) : dict;
  return out;
}

/** Wrap an island's tree: `<TextProvider locale={locale} dicts={dicts}>…</TextProvider>`. */
export function TextProvider({locale = 'en', dicts, children}: {locale?: string; dicts?: Dicts; children: ReactNode}) {
  const value = useMemo(() => ({locale, dicts: dicts ?? EN_FALLBACK}), [locale, dicts]);
  return <TextContext.Provider value={value}>{children}</TextContext.Provider>;
}

/** `const t = useText('layout'); t('header.bag', {count})` */
export function useText(ns: string): Translate {
  const {locale, dicts} = useContext(TextContext);
  return useMemo<Translate>(() => (key, vars) => translate(dicts, locale, ns, key, vars), [dicts, locale, ns]);
}

/** The page language (`en`, `da`, …) of the nearest <TextProvider>. */
export function useLocale(): string {
  return useContext(TextContext).locale;
}
