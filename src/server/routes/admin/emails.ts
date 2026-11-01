import {Hono} from 'hono';
import {z} from 'zod';

import {withDb} from '../../../platform/guards';
import type {Viewer} from '../../../platform/types';
import type {Prisma} from '../../../generated/prisma/client';
import {queueEntityTranslation} from '../../lib/contracts';
import {
  cleanVars,
  MESSAGE_FULL_SELECT,
  MESSAGE_SELECT,
  messageFullOut,
  messageOut,
  sectionProblem,
  TEMPLATE_SELECT,
  templateOut,
  unknownVariables,
} from '../../lib/email/admin';
import {ACTIVE_TEMPLATE_KEYS, ACTIVE_TEMPLATES, activeTemplate, type TemplateDefault} from '../../lib/email/defaults';
import {DELIVERY_SELECT, deliveryOut, deliveryProblems, emailDeliveryPatch, loadDelivery} from '../../lib/email/delivery';
import {loadEmailSettings, originOf, providerConfigOf, queueTemplate, render, resendMessage, type EmailVars} from '../../lib/email/send';
import type {EmailMessageCounts, EmailStatus} from '../../lib/email/types';
import type {Db} from '../../lib/db';
import {invalid, notFound} from '../../lib/errors';
import {cursorDate, decodeCursor, keysetPage, keysetWhere, orderByOf, pageSizeOf} from '../../lib/http';
import {emailField, intId, json, pageQuery, params, query} from '../../lib/validate';

/**
 * Admin: Email templates, the message log / outbox and delivery settings. WP-22: port of VAREL
 * worker/routes/admin/emails.ts (+ the email part of VAREL's admin settings); VAREL `/api/admin/emails…` is
 * `/site-api/manage/emails…` here.
 *
 *   GET    /site-api/manage/emails/templates               AdminEmailTemplate[] (the 9 active templates, VAREL order)
 *   GET    /site-api/manage/emails/templates/:key          AdminEmailTemplate
 *   PATCH  /site-api/manage/emails/templates/:key          EmailTemplateInput → AdminEmailTemplate
 *   POST   /site-api/manage/emails/templates/:key/reset    → AdminEmailTemplate (text back to default, `enabled` kept)
 *   POST   /site-api/manage/emails/templates/:key/preview  {subject?, body?, vars?} → EmailPreview (nothing saved)
 *   POST   /site-api/manage/emails/templates/:key/test     {to?, subject?, body?, vars?} → 201 AdminEmailMessageFull
 *   GET    /site-api/manage/emails/messages                CursorPage<AdminEmailMessage> ?q&status&template&relatedType&relatedId&cursor&pageSize
 *   GET    /site-api/manage/emails/messages/counts         EmailMessageCounts (each 0–100, `capped` past 100)
 *   GET    /site-api/manage/emails/messages/:id            AdminEmailMessageFull
 *   POST   /site-api/manage/emails/messages/:id/resend     → 201 AdminEmailMessageFull (the NEW row)
 *   GET    /site-api/manage/emails/delivery                EmailDelivery
 *   PATCH  /site-api/manage/emails/delivery                EmailDeliveryInput → EmailDelivery
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check` (area: settings for
 * reads AND writes, MANAGE_AREAS.emails: the outbox holds customer addresses and order contents), then the activity
 * log. Each handler: validator → `withDb`. Every answer is `Cache-Control: private, no-store` (withViewer).
 * Retired templates (password_reset, staff_invite: the platform's account emails and the template's Users screen)
 * answer 404 like an unknown key.
 */

const keyParam = params(z.object({key: z.string().trim().max(60)}));
const idParam = params(z.object({id: intId('We cannot find that email')}));

function templateOr404(key: string): TemplateDefault {
  const d = activeTemplate(key);
  if (!d) throw notFound('We cannot find that email template');
  return d;
}

async function templateRow(db: Db, key: string) {
  return db.emailTemplate.findUnique({where: {key}, select: TEMPLATE_SELECT});
}

const subjectField = z.string({error: 'Enter a subject'}).trim().min(1, 'Enter a subject').max(200, 'Keep the subject under 200 characters');
const bodyField = z.string({error: 'Enter the email body'}).min(1, 'Enter the email body').max(20_000, 'Keep the body under 20,000 characters');
const varsField = z.record(z.string(), z.unknown(), {error: 'Use an object of sample values'}).optional();

const patchBody = z
  .object({subject: subjectField.optional(), body: bodyField.optional(), enabled: z.boolean({error: 'Use true or false'}).optional()})
  .superRefine((v, ctx) => {
    for (const k of ['subject', 'body'] as const) {
      const p = v[k] ? sectionProblem(v[k]) : null;
      if (p) ctx.addIssue({code: 'custom', path: [k], message: p});
    }
  });

const previewBody = z.object({
  subject: z.string().max(200, 'Keep the subject under 200 characters').optional(),
  body: z.string().max(20_000, 'Keep the body under 20,000 characters').optional(),
  vars: varsField,
});

const testBody = z.object({to: emailField.optional(), subject: subjectField.optional(), body: bodyField.optional(), vars: varsField});

const STATUSES = ['stored', 'queued', 'sent', 'failed', 'skipped'] as const;
const messagesQuery = z.object({
  ...pageQuery,
  status: z.enum(STATUSES, {error: `Use ${STATUSES.join(', ')}`}).optional(),
  template: z.string().trim().max(60).optional(),
  q: z.string().trim().max(200).optional(),
  relatedType: z.string().trim().max(40).optional(),
  relatedId: z.string().trim().max(60).optional(),
});

/** Translations follow customer templates only (staff alerts stay in the store's language). */
async function queueTranslation(db: Db, d: TemplateDefault, requestUrl: string) {
  if (d.audience === 'customer') await queueEntityTranslation(db, 'email_template', d.key, {requestUrl});
}

async function fullMessage(db: Db, id: number) {
  const m = await db.emailMessage.findUnique({where: {id}, select: MESSAGE_FULL_SELECT});
  if (!m) throw notFound('We cannot find that email');
  return messageFullOut(m);
}

export const emailsAdmin = new Hono<{Variables: {viewer: Viewer}}>()
  // ─── Templates ────────────────────────────────────────────────────────────
  .get('/templates', withDb, async c => {
    const rows = await c.var.db.emailTemplate.findMany({
      where: {key: {in: ACTIVE_TEMPLATE_KEYS}},
      select: TEMPLATE_SELECT,
      take: ACTIVE_TEMPLATE_KEYS.length,
    });
    return c.json(ACTIVE_TEMPLATES.map(d => templateOut(d, rows.find(r => r.key === d.key) ?? null)));
  })
  .get('/templates/:key', keyParam, withDb, async c => {
    const d = templateOr404(c.req.valid('param').key);
    return c.json(templateOut(d, await templateRow(c.var.db, d.key)));
  })
  .patch('/templates/:key', keyParam, json(patchBody), withDb, async c => {
    const d = templateOr404(c.req.valid('param').key);
    const input = c.req.valid('json');
    const db = c.var.db;
    const data: Prisma.EmailTemplateUpdateInput = {};
    if (input.subject !== undefined) data.subject = input.subject;
    if (input.body !== undefined) data.body = input.body;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    const row = await db.emailTemplate.upsert({
      where: {key: d.key},
      create: {key: d.key, subject: input.subject ?? d.subject, body: input.body ?? d.body, enabled: input.enabled ?? true},
      update: data,
      select: TEMPLATE_SELECT,
    });
    if (input.subject !== undefined || input.body !== undefined) await queueTranslation(db, d, c.req.url);
    return c.json(templateOut(d, row));
  })
  .post('/templates/:key/reset', keyParam, withDb, async c => {
    const d = templateOr404(c.req.valid('param').key);
    const db = c.var.db;
    const row = await db.emailTemplate.upsert({
      where: {key: d.key},
      create: {key: d.key, subject: d.subject, body: d.body},
      update: {subject: d.subject, body: d.body},
      select: TEMPLATE_SELECT,
    });
    await queueTranslation(db, d, c.req.url);
    return c.json(templateOut(d, row));
  })
  .post('/templates/:key/preview', keyParam, json(previewBody), withDb, async c => {
    const d = templateOr404(c.req.valid('param').key);
    const input = c.req.valid('json');
    const db = c.var.db;
    const [row, s] = await Promise.all([templateRow(db, d.key), loadEmailSettings(db)]);
    const tpl = {subject: input.subject ?? row?.subject ?? d.subject, body: input.body ?? row?.body ?? d.body};
    const vars: EmailVars = input.vars ? cleanVars(input.vars) : (d.sample as EmailVars);
    const out = render(tpl, vars, s, originOf(c.req.url), s.defaultLocale);
    return c.json({...out, unknown: unknownVariables(d, tpl, vars), problem: sectionProblem(tpl.body) ?? sectionProblem(tpl.subject)});
  })
  .post('/templates/:key/test', keyParam, json(testBody), withDb, async c => {
    const d = templateOr404(c.req.valid('param').key);
    const input = c.req.valid('json');
    const db = c.var.db;
    const viewer = c.var.viewer;
    const to = input.to ?? viewer.email ?? '';
    if (!to) throw invalid({to: 'Enter an email address'});
    const row = await templateRow(db, d.key);
    const tpl = {subject: input.subject ?? row?.subject ?? d.subject, body: input.body ?? row?.body ?? d.body};
    const vars: EmailVars = input.vars ? cleanVars(input.vars) : (d.sample as EmailVars);
    const result = await queueTemplate(db, d.key, to, vars, {
      override: {subject: `[Test] ${tpl.subject}`, body: tpl.body},
      related: {type: 'test', id: String(viewer.id ?? '')},
      wait: true,
      force: true,
      requestUrl: c.req.url,
    });
    return c.json(await fullMessage(db, result.id), 201);
  })

  // ─── Messages (outbox and log) ─────────────────────────────────────────────
  .get('/messages', query(messagesQuery), withDb, async c => {
    const q = c.req.valid('query');
    const size = pageSizeOf(q.pageSize);
    const cursor = decodeCursor(q.cursor);
    const afterDate = cursor ? cursorDate(cursor[0]) : null;
    const afterId = cursor ? Number(cursor[1]) : NaN;
    const after = afterDate && Number.isSafeInteger(afterId) ? ([afterDate, afterId] as const) : null;
    const search: Prisma.EmailMessageWhereInput = q.q
      ? q.q.includes('@')
        ? {to: q.q.toLowerCase()}
        : {OR: [{to: {contains: q.q, mode: 'insensitive'}}, {subject: {contains: q.q, mode: 'insensitive'}}]}
      : {};
    const where: Prisma.EmailMessageWhereInput = {
      AND: [
        {
          ...(q.status ? {status: q.status} : {}),
          ...(q.template ? {template: q.template} : {}),
          ...(q.relatedType ? {relatedType: q.relatedType} : {}),
          ...(q.relatedId ? {relatedId: q.relatedId} : {}),
        },
        search,
        keysetWhere('createdAt', 'desc', after) as Prisma.EmailMessageWhereInput,
      ],
    };
    const rows = await c.var.db.emailMessage.findMany({
      where,
      orderBy: orderByOf('createdAt', 'desc') as Prisma.EmailMessageOrderByWithRelationInput[],
      take: size + 1,
      select: MESSAGE_SELECT,
    });
    const page = keysetPage(rows, size, r => [r.createdAt, r.id]);
    return c.json({items: page.items.map(messageOut), nextCursor: page.nextCursor});
  })
  .get('/messages/counts', withDb, async c => {
    const db = c.var.db;
    const found = await Promise.all(
      STATUSES.map(status => db.emailMessage.findMany({where: {status}, select: {id: true}, orderBy: {createdAt: 'desc'}, take: 101}))
    );
    const out: EmailMessageCounts = {stored: 0, queued: 0, sent: 0, failed: 0, skipped: 0, capped: [] as EmailStatus[]};
    STATUSES.forEach((status, i) => {
      const n = found[i].length;
      out[status] = Math.min(n, 100);
      if (n > 100) out.capped.push(status);
    });
    return c.json(out);
  })
  .get('/messages/:id', idParam, withDb, async c => c.json(await fullMessage(c.var.db, c.req.valid('param').id)))
  .post('/messages/:id/resend', idParam, withDb, async c => {
    const db = c.var.db;
    const r = await resendMessage(db, c.req.valid('param').id);
    if (!r) throw notFound('We cannot find that email');
    return c.json(await fullMessage(db, r.id), 201);
  })

  // ─── Delivery (provider and sender; VAREL Settings · Email) ────────────────
  .get('/delivery', withDb, async c => c.json(deliveryOut(await loadDelivery(c.var.db))))
  .patch('/delivery', json(emailDeliveryPatch), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const current = await loadDelivery(db);
    const provider = input.emailProvider ?? current.emailProvider;
    const emailConfig = input.emailConfig ?? providerConfigOf(current.emailConfig);
    const problems = deliveryProblems(provider, emailConfig);
    if (problems) throw invalid(problems);
    const data: Prisma.SettingUpdateInput = {};
    if (input.emailProvider !== undefined) data.emailProvider = input.emailProvider;
    if (input.emailConfig !== undefined) data.emailConfig = input.emailConfig;
    if (input.emailFromName !== undefined) data.emailFromName = input.emailFromName;
    if (input.emailFromAddress !== undefined) data.emailFromAddress = input.emailFromAddress;
    if (input.emailReplyTo !== undefined) data.emailReplyTo = input.emailReplyTo;
    if (input.staffAlertEmail !== undefined) data.staffAlertEmail = input.staffAlertEmail;
    const row = Object.keys(data).length ? await db.setting.update({where: {id: 1}, data, select: DELIVERY_SELECT}) : current;
    return c.json(deliveryOut(row));
  });
