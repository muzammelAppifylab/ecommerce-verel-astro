import {Hono} from 'hono';
import {z} from 'zod';

import type {PrismaClient} from '../../../generated/prisma/client';
import type {
  EntityField,
  EntityTranslations,
  LocaleCoverage,
  TranslateMissingResult,
  TranslationList,
  TranslationRow,
  TranslationsStatus,
} from '../../../lib/types/admin/translations';
import {withDb} from '../../../platform/guards';
import {conflict, HttpError, invalid, notFound} from '../../lib/errors';
import {keysetPage} from '../../lib/http';
import {runBackfill} from '../../lib/i18n/backfill';
import type {TranslatableEntity} from '../../lib/i18n/localize';
import {getProvider, providerReady} from '../../lib/i18n/providers';
import {ENTITIES, ENTITY_FIELDS, isEntity, isJsonField, loadSources} from '../../lib/i18n/sources';
import {afterCursor, type Cell, cellKey, compareCells, decodeCellCursor, entityCells, filterCells, localesFor} from '../../lib/i18n/status';
import {encodeValue, hashMemo, type I18nConfig, loadI18nConfig, sourceHash, translateEntity} from '../../lib/i18n/translate';
import {json, pageQuery, query} from '../../lib/validate';

/**
 * Admin: Content translations (port of VAREL worker/routes/admin/translations.ts; docs/I18N.md). VAREL
 * `/api/admin/translations…` is `/site-api/manage/translations…` here. Shapes: src/lib/types/admin/translations.ts.
 *
 *   GET    /site-api/manage/translations               TranslationList ?entity&locale&status&q&cursor&pageSize (keyset)
 *   GET    /site-api/manage/translations/status        TranslationsStatus: coverage per entity type and locale
 *   POST   /site-api/manage/translations/retranslate   {entity, entityId, field?, locale?} → EntityTranslations & {result}
 *                                                      machine-translate again (replaces manual edits)
 *   POST   /site-api/manage/translations/translate-missing {entity?, locale?} → TranslateMissingResult (bounded batch)
 *   GET    /site-api/manage/translations/:entity/:id   EntityTranslations: one record, every locale
 *   PUT    /site-api/manage/translations/:entity/:id   {field, locale, value} → EntityTranslations (manual translation)
 *   DELETE /site-api/manage/translations/:entity/:id   ?field&locale → EntityTranslations: drop manual translations and
 *                                                      translate them automatically again
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check` (area: content,
 * reads and writes; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Each handler: validator →
 * `withDb`. Admin handlers read and write SOURCE fields only. The languages themselves, the default language and
 * the provider are store settings (`PATCH /site-api/manage/settings`, WP-23).
 *
 * Differences from VAREL: the list is a keyset page (`nextCursor`, no `total`; the workspace header shows the
 * totals from `/status`) and its rows carry `origin` (VAREL renamed it `source` on the wire, and its client renamed
 * it back). `translate-missing` does less per request (20 field-locales, 20 s, 120 provider strings; VAREL 150 / 25 s):
 * the screen calls it in a loop. Provider secrets come from `config.ownerSecret`.
 */

type Env = {Variables: {db: PrismaClient}};

const LIST_SIZE = 25;

const entityField = z
  .string({error: 'Choose a content type'})
  .trim()
  .refine(isEntity, 'Choose one of the listed content types')
  .transform(e => e as TranslatableEntity);

const localeField = z
  .string({error: 'Choose a language'})
  .trim()
  .toLowerCase()
  .max(10, 'Choose a language')
  .regex(/^[a-z]{2,3}$/, 'Choose a language');

const fieldName = z.string({error: 'Choose a field'}).trim().min(1, 'Choose a field').max(60, 'Choose a field');

const coverage = (): LocaleCoverage => ({total: 0, translated: 0, missing: 0, stale: 0, auto: 0, manual: 0});

function tally(target: LocaleCoverage, c: Cell) {
  target.total++;
  if (c.status === 'missing') target.missing++;
  else {
    target.translated++;
    if (c.status === 'stale') target.stale++;
    if (c.origin === 'manual') target.manual++;
    else target.auto++;
  }
}

/** The `:entity/:id` path: a known content type and a record id that fits the table, else 404. */
function target(entity: string | undefined, id: string | undefined): {entity: TranslatableEntity; entityId: string} {
  if (!entity || !isEntity(entity)) throw notFound('We cannot find that content type');
  const entityId = id ?? '';
  if (!entityId || entityId.length > 120) throw notFound('We cannot find that record');
  return {entity, entityId};
}

/** Source fields of one record, or 404. */
async function sourceOf(db: PrismaClient, entity: TranslatableEntity, entityId: string) {
  const [src] = await loadSources(db, entity, [entityId]);
  if (!src) throw notFound('We cannot find that record');
  return src;
}

function checkTarget(cfg: I18nConfig, entity: TranslatableEntity, field: string | undefined, locale: string | undefined) {
  if (field && !ENTITY_FIELDS[entity].includes(field)) throw invalid({field: 'This field is not translated'});
  if (locale && !localesFor(cfg, entity).includes(locale)) throw invalid({locale: 'Choose an enabled language other than the default'});
}

const PROVIDER_NOT_READY = () => conflict('PROVIDER_NOT_READY', 'Set up a translation provider in Settings → Languages first');

/** One record's translations (EntityTranslations). */
async function entityDetail(db: PrismaClient, cfg: I18nConfig, entity: TranslatableEntity, entityId: string): Promise<EntityTranslations> {
  const src = await sourceOf(db, entity, entityId);
  const locales = localesFor(cfg, entity);
  const rows = locales.length
    ? await db.translation.findMany({
        where: {entity, entityId, locale: {in: locales}},
        select: {field: true, locale: true, value: true, source: true, sourceHash: true, updatedAt: true},
      })
    : [];
  const fields: EntityField[] = [];
  for (const field of ENTITY_FIELDS[entity]) {
    const v = src.fields[field];
    if (v == null) continue;
    const hash = await sourceHash(v);
    const translations: EntityField['translations'] = {};
    for (const l of locales) {
      const r = rows.find(x => x.field === field && x.locale === l);
      translations[l] = r
        ? {value: r.value, source: r.source === 'manual' ? 'manual' : 'auto', stale: r.sourceHash !== hash, updatedAt: r.updatedAt.toISOString()}
        : null;
    }
    fields.push({field, sourceValue: encodeValue(v), json: isJsonField(entity, field), translations});
  }
  return {entity, entityId, label: src.label, defaultLocale: cfg.defaultLocale, locales, fields};
}

const listQuery = z.object({
  ...pageQuery,
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional(),
  entity: entityField.optional(),
  locale: z.string().trim().toLowerCase().max(10).optional(),
  status: z.enum(['missing', 'stale', 'auto', 'manual', '']).optional(),
});

const retranslateBody = z.object({
  entity: entityField,
  entityId: z.string({error: 'Choose a record'}).trim().min(1, 'Choose a record').max(120, 'Choose a record'),
  field: z.string().trim().max(60).optional(),
  locale: z.string().trim().toLowerCase().max(10).optional(),
});

const missingBody = z.object({
  entity: entityField.optional(),
  locale: z.string().trim().toLowerCase().max(10).optional(),
});

const putBody = z.object({
  field: fieldName,
  locale: localeField,
  value: z.union([z.string().max(200_000, 'That translation is too long'), z.array(z.unknown()), z.record(z.string(), z.unknown())], {
    error: 'Enter a translation',
  }),
});

const revertQuery = z.object({
  field: z.string().trim().max(60).optional(),
  locale: z.string().trim().toLowerCase().max(10).optional(),
});

export const translationsAdmin = new Hono<Env>()
  .get('/', query(listQuery), withDb, async c => {
    const p = c.req.valid('query');
    const db = c.var.db;
    const cfg = await loadI18nConfig(db);
    const size = Math.min(p.pageSize ?? LIST_SIZE, 100);
    const hash = hashMemo();
    const entities = p.entity ? [p.entity] : ENTITIES.filter(e => e !== 'ui' || localesFor(cfg, e).length);
    const parts = await Promise.all(entities.map(entity => entityCells(db, cfg, entity, {locale: p.locale || undefined, withValues: true, hash})));
    const cells = filterCells(
      parts.flatMap(part => part.cells),
      {status: p.status, q: p.q}
    ).sort(compareCells(cfg));
    const page = afterCursor(cells, decodeCellCursor(p.cursor), cfg).slice(0, size + 1);
    const body = keysetPage(page, size, cell => cellKey(cell, cfg));
    const items = body.items.map(
      (cell): TranslationRow => ({
        entity: cell.entity,
        entityId: cell.entityId,
        label: cell.label,
        field: cell.field,
        locale: cell.locale,
        sourceValue: cell.sourceValue,
        value: cell.value,
        status: cell.status,
        origin: cell.origin,
        updatedAt: cell.updatedAt,
      })
    );
    return c.json({items, nextCursor: body.nextCursor} satisfies TranslationList);
  })
  .get('/status', withDb, async c => {
    const db = c.var.db;
    const cfg = await loadI18nConfig(db);
    const targets = cfg.locales.filter(l => l !== cfg.defaultLocale);
    const totals = Object.fromEntries(targets.map(l => [l, coverage()]));
    const hash = hashMemo();
    const covered = ENTITIES.filter(entity => localesFor(cfg, entity).length);
    const parts = await Promise.all(covered.map(entity => entityCells(db, cfg, entity, {hash})));
    const entities = covered.map((entity, i) => {
      const {cells, sources} = parts[i]!;
      const byLocale = Object.fromEntries(localesFor(cfg, entity).map(l => [l, coverage()]));
      for (const cell of cells) {
        tally(byLocale[cell.locale]!, cell);
        tally(totals[cell.locale]!, cell);
      }
      const total = sources.reduce((n, s) => n + ENTITY_FIELDS[entity].filter(f => s.fields[f] != null).length, 0);
      return {entity, total, locales: byLocale};
    });
    return c.json({
      defaultLocale: cfg.defaultLocale,
      locales: targets,
      provider: cfg.provider === 'mock' ? 'none' : cfg.provider,
      autoTranslate: cfg.autoTranslate,
      providerReady: providerReady(cfg.provider),
      entities,
      totals,
    } satisfies TranslationsStatus);
  })
  .post('/retranslate', json(retranslateBody), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const cfg = await loadI18nConfig(db);
    checkTarget(cfg, input.entity, input.field || undefined, input.locale || undefined);
    const provider = getProvider(cfg.provider);
    if (!provider) throw PROVIDER_NOT_READY();
    const src = await sourceOf(db, input.entity, input.entityId);
    const fields = Object.fromEntries(Object.entries(src.fields).filter(([f]) => !input.field || f === input.field));
    const result = await translateEntity(db, input.entity, input.entityId, fields, {
      config: cfg,
      provider,
      locales: input.locale ? [input.locale] : localesFor(cfg, input.entity),
      force: true,
      overwriteManual: true,
    });
    if (result.failed && !result.translated) throw new HttpError(502, 'TRANSLATION_FAILED', 'The translation provider did not respond. Try again in a moment');
    return c.json({...(await entityDetail(db, cfg, input.entity, input.entityId)), result});
  })
  .post('/translate-missing', json(missingBody), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const cfg = await loadI18nConfig(db);
    if (input.locale && !cfg.locales.includes(input.locale)) throw invalid({locale: 'Choose an enabled language'});
    if (!providerReady(cfg.provider)) throw PROVIDER_NOT_READY();
    const r = await runBackfill(db, cfg, {entity: input.entity, locale: input.locale || undefined, limit: 20, budgetMs: 20_000, maxCalls: 120});
    return c.json(r satisfies TranslateMissingResult);
  })
  .get('/:entity/:id', withDb, async c => {
    const {entity, entityId} = target(c.req.param('entity'), c.req.param('id'));
    const db = c.var.db;
    const cfg = await loadI18nConfig(db);
    return c.json(await entityDetail(db, cfg, entity, entityId));
  })
  .put('/:entity/:id', json(putBody), withDb, async c => {
    const {entity, entityId} = target(c.req.param('entity'), c.req.param('id'));
    const input = c.req.valid('json');
    const db = c.var.db;
    const cfg = await loadI18nConfig(db);
    checkTarget(cfg, entity, input.field, input.locale);
    const src = await sourceOf(db, entity, entityId);
    const source = src.fields[input.field];
    if (source == null) throw invalid({field: 'This field has no text to translate yet'});

    let value: string;
    if (isJsonField(entity, input.field)) {
      let parsed: unknown = input.value;
      if (typeof input.value === 'string') {
        try {
          parsed = JSON.parse(input.value);
        } catch {
          throw invalid({value: 'Use valid JSON with the same structure as the source'});
        }
      }
      if (Array.isArray(parsed) !== Array.isArray(source) || typeof parsed !== 'object' || parsed === null) {
        throw invalid({value: 'Keep the same structure as the source'});
      }
      value = JSON.stringify(parsed);
      if (value.length > 200_000) throw invalid({value: 'That translation is too long'});
    } else {
      if (typeof input.value !== 'string') throw invalid({value: 'Enter the translation as text'});
      value = input.value;
      if (!value.trim()) throw invalid({value: 'Enter a translation, or revert to the automatic one'});
    }
    const hash = await sourceHash(source);
    await db.translation.upsert({
      where: {entity_entityId_field_locale: {entity, entityId, field: input.field, locale: input.locale}},
      create: {entity, entityId, field: input.field, locale: input.locale, value, source: 'manual', sourceHash: hash},
      update: {value, source: 'manual', sourceHash: hash},
      select: {id: true},
    });
    return c.json(await entityDetail(db, cfg, entity, entityId));
  })
  .delete('/:entity/:id', query(revertQuery), withDb, async c => {
    const {entity, entityId} = target(c.req.param('entity'), c.req.param('id'));
    const q = c.req.valid('query');
    const db = c.var.db;
    const cfg = await loadI18nConfig(db);
    checkTarget(cfg, entity, q.field || undefined, q.locale || undefined);
    const src = await sourceOf(db, entity, entityId);
    const where = {entity, entityId, source: 'manual', ...(q.field ? {field: q.field} : {}), ...(q.locale ? {locale: q.locale} : {})};
    const manual = await db.translation.findMany({where, select: {field: true, locale: true}, take: 1000});
    if (manual.length) await db.translation.deleteMany({where});
    const provider = getProvider(cfg.provider);
    if (provider && manual.length) {
      const fields = Object.fromEntries([...new Set(manual.map(m => m.field))].map(f => [f, src.fields[f]]));
      await translateEntity(db, entity, entityId, fields, {config: cfg, provider, locales: [...new Set(manual.map(m => m.locale))]});
    }
    return c.json(await entityDetail(db, cfg, entity, entityId));
  });
