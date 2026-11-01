import {describe, expect, it} from 'vitest';

import {addressBody, addressParam, addressPatch, deleteBody, expiredVisitorCookie, preferencesBody, profileBody} from '../src/server/routes/account';
import {downloadQuery, fileParam, isPlatformFileId, wantsJson} from '../src/server/routes/downloads';

const issues = (r: {success: boolean; error?: {issues: {path: PropertyKey[]; message: string}[]}}) =>
  Object.fromEntries((r.error?.issues ?? []).map(i => [i.path.join('.'), i.message]));

describe('account route schemas (src/server/routes/account.ts)', () => {
  it('profile: names required and bounded, phone optional, email stripped', () => {
    const empty = profileBody.safeParse({firstName: '  ', lastName: ''});
    expect(empty.success).toBe(false);
    expect(Object.keys(issues(empty))).toEqual(expect.arrayContaining(['firstName', 'lastName']));
    const long = profileBody.safeParse({firstName: 'x'.repeat(81), lastName: 'Ok'});
    expect(long.success).toBe(false);
    expect(issues(long).firstName).toMatch(/80/);
    const ok = profileBody.parse({firstName: ' Mira ', lastName: 'Halvorsen', phone: '', email: 'x@y.z'});
    expect(ok).toEqual({firstName: 'Mira', lastName: 'Halvorsen', phone: null});
    expect(profileBody.safeParse({firstName: 'A', lastName: 'B', phone: '1'.repeat(41)}).success).toBe(false);
  });

  it('preferences: a boolean', () => {
    expect(preferencesBody.parse({newsletter: true})).toEqual({newsletter: true});
    expect(preferencesBody.safeParse({newsletter: 'yes'}).success).toBe(false);
  });

  it('address: known countries, canonical names, bounded fields', () => {
    const base = {name: 'Mira', line1: '112 Studio', city: 'Copenhagen', zip: '2200', country: 'denmark'};
    const ok = addressBody.parse(base);
    expect(ok.country).toBe('Denmark');
    expect(ok.label).toBeNull();
    expect(ok.primary).toBeUndefined();
    const bad = addressBody.safeParse({...base, country: 'Atlantis'});
    expect(issues(bad).country).toBe('Choose a country we ship to');
    expect(addressBody.safeParse({...base, city: 'x'.repeat(101)}).success).toBe(false);
    expect(addressBody.safeParse({...base, city: 'x'.repeat(100)}).success).toBe(true);
    expect(addressPatch.parse({primary: true})).toEqual({primary: true});
  });

  it('address id param', () => {
    expect(addressParam.parse({id: '12'})).toEqual({id: 12});
    for (const id of ['0', '-1', 'abc', '99999999999', '1.5']) expect(addressParam.safeParse({id}).success).toBe(false);
  });

  it('delete body: password may be empty, confirm trimmed and bounded', () => {
    expect(deleteBody.parse({confirm: ' DELETE '})).toEqual({password: '', confirm: 'DELETE'});
    expect(deleteBody.safeParse({confirm: 'x'.repeat(17)}).success).toBe(false);
    expect(deleteBody.safeParse({password: 'x'.repeat(401), confirm: 'DELETE'}).success).toBe(false);
  });

  it('expired visitor cookie', () => {
    expect(expiredVisitorCookie('https://shop.example/x')).toMatch(/^visitor_id=; Max-Age=0; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    expect(expiredVisitorCookie('http://localhost:4413/x')).not.toMatch(/Secure/);
  });
});

describe('download references (src/server/routes/downloads.ts)', () => {
  it('only safe names reach the lookup', () => {
    for (const bad of ['../x', '.env', 'a/b', 'x'.repeat(201), '', 'a b']) expect(fileParam.safeParse(bad).success).toBe(false);
    for (const ok of ['varel-care-guide.pdf', 'file_0123456789abcdefghijklmnop']) expect(fileParam.safeParse(ok).success).toBe(true);
  });

  it('platform file ids', () => {
    expect(isPlatformFileId('file_0123456789abcdefghijklmnop')).toBe(true);
    expect(isPlatformFileId('file_0123456789ABCDEFGHIJKLMNOP')).toBe(false);
    expect(isPlatformFileId('varel-care-guide.pdf')).toBe(false);
  });

  it('JSON or redirect', () => {
    expect(wantsJson('json', null)).toBe(true);
    expect(wantsJson(undefined, 'application/json')).toBe(true);
    expect(wantsJson(undefined, 'text/html,application/json')).toBe(false);
    expect(wantsJson(undefined, '*/*')).toBe(false);
    expect(downloadQuery.safeParse({format: 'xml'}).success).toBe(false);
    expect(downloadQuery.safeParse({order: 'x'.repeat(21)}).success).toBe(false);
  });
});
