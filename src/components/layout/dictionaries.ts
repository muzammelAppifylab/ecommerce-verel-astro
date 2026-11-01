/*
 * SERVER ONLY (imported by .astro frontmatter, never by an island): the storefront's word catalogs,
 * VAREL `src/locales/<locale>/<namespace>.json` copied into `src/locales/` by F4.
 *
 * Pages translate on the server and hand each island only the namespaces (or keys) it needs, so no catalog
 * ships to the browser whole. Missing catalogs or keys fall back to English (src/components/varel/text-en.ts).
 */
import {type Dict, type Dicts, mergeDicts, translate, type TextVars} from '@/components/varel/text';
import {EN_FALLBACK} from '@/components/varel/text-en';
import {DEFAULT_LOCALE} from '@/components/varel/href';

/* Every catalog, read at build time (an empty object while src/locales has no files). */
const FILES = import.meta.glob<Dict>('/src/locales/*/*.json', {eager: true, import: 'default'});

const CATALOGS: Record<string, Dicts> = {};
for (const [path, dict] of Object.entries(FILES)) {
  const m = /\/src\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (m) (CATALOGS[m[1]] ??= {})[m[2]] = dict;
}

/** Languages with catalogs on disk (always includes English). */
export const CATALOG_LOCALES = [...new Set([DEFAULT_LOCALE, ...Object.keys(CATALOGS)])];

const pick = (dict: Dict, keys: readonly string[]): Dict => {
  const out: Dict = {};
  for (const key of keys) if (dict[key] !== undefined) out[key] = dict[key];
  return out;
};

/**
 * The catalogs an island needs, in `locale` over English: `{layout: true}` for a whole namespace,
 * `{privacy: ['banner', 'dialog']}` for some of its top-level keys.
 */
export function dictsFor(locale: string, spec: Record<string, true | readonly string[]>): Dicts {
  const out: Dicts = {};
  for (const [ns, keys] of Object.entries(spec)) {
    const merged = mergeDicts(
      mergeDicts({[ns]: EN_FALLBACK[ns] ?? {}}, CATALOGS[DEFAULT_LOCALE]?.[ns] ? {[ns]: CATALOGS[DEFAULT_LOCALE][ns]} : undefined),
      locale !== DEFAULT_LOCALE && CATALOGS[locale]?.[ns] ? {[ns]: CATALOGS[locale][ns]} : undefined
    )[ns];
    out[ns] = keys === true ? merged : pick(merged, keys);
  }
  return out;
}

/** A server-side translator: `const t = serverText('da'); t('layout', 'footer.studio')`. */
export function serverText(locale: string) {
  const cache: Dicts = {};
  return (ns: string, key: string, vars?: TextVars) => {
    cache[ns] ??= dictsFor(locale, {[ns]: true})[ns];
    return translate(cache, locale, ns, key, vars);
  };
}
