import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** `PATCH /site-api/account/locale` (WP-15; VAREL worker/routes/i18n.ts). */
describe.skipIf(!DATABASE_URL)('remember the customer language (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  beforeEach(resetDatabase);
  afterAll(() => db.$disconnect());

  const patch = (browser: Browser, body: unknown, headers: Record<string, string> = {}) =>
    browser.request('PATCH', '/site-api/account/locale', body, headers);

  it('guests get 401', async () => {
    expect((await patch(new Browser(app), {locale: 'da'})).status).toBe(401);
  });

  it('refuses languages the store does not offer', async () => {
    const browser = await signedIn(app, 'mira@example.test');
    for (const locale of ['xx', 'd'.repeat(11)]) {
      const res = await patch(browser, {locale});
      expect(res.status, locale).toBe(422);
      expect(res.json.fields).toHaveProperty('locale');
    }
  });

  it('saves the language on the profile (made when missing) and sets the cookie', async () => {
    const browser = await signedIn(app, 'mira@example.test');
    const res = await patch(browser, {locale: 'DA'});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({locale: 'da'});
    const cookie = res.headers.getSetCookie().find(line => line.startsWith('varel_locale='))!;
    expect(cookie).toMatch(/^varel_locale=da;/);
    expect(cookie).toMatch(/Max-Age=31536000/);
    expect(cookie).not.toMatch(/HttpOnly/i);
    const id = await userId('mira@example.test');
    const profile = await db.customerProfile.findUniqueOrThrow({where: {userId: id}});
    expect(profile.locale).toBe('da');

    // The same language again writes nothing.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect((await patch(browser, {locale: 'da'})).status).toBe(200);
    const again = await db.customerProfile.findUniqueOrThrow({where: {userId: id}});
    expect(again.updatedAt.getTime()).toBe(profile.updatedAt.getTime());

    expect((await patch(browser, {locale: 'sv'})).json).toEqual({locale: 'sv'});
    expect((await db.customerProfile.findUniqueOrThrow({where: {userId: id}})).locale).toBe('sv');
  });

  it('no body: the request language', async () => {
    const browser = await signedIn(app, 'mira@example.test');
    const res = await patch(browser, {}, {'x-locale': 'de'});
    expect(res.json).toEqual({locale: 'de'});
  });
});
