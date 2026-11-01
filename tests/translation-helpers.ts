/* Shared fakes for the translation tests (WP-25). */
import type {Db} from '../src/server/lib/db';
import type {I18nConfig} from '../src/server/lib/i18n/translate';

// ─── An in-memory Translation table ─────────────────────────────────────────

export type Row = {entity: string; entityId: string; field: string; locale: string; value: string; source: string; sourceHash: string; updatedAt: Date};

/** Enough of Prisma for the engine: findMany / deleteMany with `{in}` filters, and the bulk upsert statement
    (`$executeRaw` with `Prisma.join` of 6 parameters per row: entity, entityId, field, locale, value, sourceHash). */
export function fakeDb(extra: Record<string, unknown> = {}) {
  const rows: Row[] = [];
  const match = (r: Row, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      const x = (r as unknown as Record<string, unknown>)[k];
      return v && typeof v === 'object' && 'in' in (v as object) ? (v as {in: unknown[]}).in.includes(x) : x === v;
    });
  const db = {
    translation: {
      findMany: async ({where}: {where: Record<string, unknown>}) => rows.filter(r => match(r, where)).map(r => ({...r})),
      deleteMany: async ({where}: {where: Record<string, unknown>}) => {
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i--)
          if (match(rows[i]!, where)) {
            rows.splice(i, 1);
            count++;
          }
        return {count};
      },
    },
    $executeRaw: async (_strings: TemplateStringsArray, ...args: {values?: unknown[]}[]) => {
      const values = args.flatMap(a => a?.values ?? []);
      let n = 0;
      for (let i = 0; i + 5 < values.length; i += 6) {
        const [entity, entityId, field, locale, value, hash] = values.slice(i, i + 6) as string[];
        const r = rows.find(x => x.entity === entity && x.entityId === entityId && x.field === field && x.locale === locale);
        if (r) Object.assign(r, {value, source: 'auto', sourceHash: hash, updatedAt: new Date()});
        else rows.push({entity: entity!, entityId: entityId!, field: field!, locale: locale!, value: value!, source: 'auto', sourceHash: hash!, updatedAt: new Date()});
        n++;
      }
      return n;
    },
    ...extra,
  };
  return {db: db as unknown as Db, rows};
}

export const cfg: I18nConfig = {defaultLocale: 'en', locales: ['en', 'da', 'de', 'fr', 'es', 'sv'], provider: 'mock', autoTranslate: true};

