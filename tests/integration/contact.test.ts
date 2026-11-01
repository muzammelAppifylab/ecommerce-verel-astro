import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

const MESSAGE = {name: 'Ana', email: 'Ana@Example.test', subject: 'Repairs', message: 'My coat needs a button.', orderNumber: 'vrl-1001'};

/** WP-07: POST /site-api/contact, against Postgres. */
describe.skipIf(!DATABASE_URL)('contact messages (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(resetDatabase);

  it('stores a valid message', async () => {
    const res = await new Browser(app).post('/site-api/contact', MESSAGE);
    expect(res.status).toBe(204);
    const rows = await db.contactMessage.findMany({select: {name: true, email: true, subject: true, order: true, message: true}});
    expect(rows).toEqual([{name: 'Ana', email: 'ana@example.test', subject: 'Repairs', order: 'VRL-1001', message: 'My coat needs a button.'}]);
  });

  it('answers 204 to a filled honeypot and stores nothing', async () => {
    expect((await new Browser(app).post('/site-api/contact', {...MESSAGE, website: 'http://spam.test'})).status).toBe(204);
    expect(await db.contactMessage.findMany({select: {id: true}})).toEqual([]);
  });

  it('puts field errors on their fields', async () => {
    const res = await new Browser(app).post('/site-api/contact', {name: '', email: 'nope', subject: '', message: '', orderNumber: 'no spaces'});
    expect(res.status).toBe(422);
    expect(res.json.fields).toMatchObject({
      name: 'Enter your name',
      email: 'Enter a valid email address',
      subject: 'Choose a topic',
      message: 'Write your message',
      orderNumber: 'Use the order number from your confirmation',
    });
  });

  it('limits one address to three messages in ten minutes', async () => {
    const browser = new Browser(app);
    for (let i = 0; i < 3; i++) expect((await browser.post('/site-api/contact', MESSAGE)).status).toBe(204);
    const fourth = await browser.post('/site-api/contact', MESSAGE);
    expect(fourth.status).toBe(429);
    expect(fourth.json).toMatchObject({error: 'too_many_requests'});
    expect(fourth.headers.get('retry-after')).toBe('600');
  });
});
