import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Email templates and message log. WP-22 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/emails.ts: VAREL `/api/admin/emails…` is `/site-api/manage/emails…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/emails/templates           AdminEmailTemplate[]
 *   GET    /site-api/manage/emails/templates/:key      AdminEmailTemplate
 *   PATCH  /site-api/manage/emails/templates/:key      EmailTemplateInput → AdminEmailTemplate
 *   POST   /site-api/manage/emails/templates/:key/reset → AdminEmailTemplate
 *   POST   /site-api/manage/emails/templates/:key/preview {subject, body, vars?} → EmailPreview
 *   POST   /site-api/manage/emails/templates/:key/test {to} → AdminEmailMessage
 *   GET    /site-api/manage/emails/messages            CursorPage<AdminEmailMessage> ?q&status&template&cursor&pageSize
 *   GET    /site-api/manage/emails/messages/:id        AdminEmailMessageDetail
 *   POST   /site-api/manage/emails/messages/:id/resend → AdminEmailMessage
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: settings; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const emailsAdmin = new Hono()
  .get('/templates', notImplemented)
  .get('/templates/:key', notImplemented)
  .patch('/templates/:key', notImplemented)
  .post('/templates/:key/reset', notImplemented)
  .post('/templates/:key/preview', notImplemented)
  .post('/templates/:key/test', notImplemented)
  .get('/messages', notImplemented)
  .get('/messages/:id', notImplemented)
  .post('/messages/:id/resend', notImplemented);
