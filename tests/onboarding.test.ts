import {describe, expect, it} from 'vitest';

import {TOKEN_RE, tokenFrom} from '../src/components/auth/auth-page';
import {richParts} from '../src/components/auth/auth-server';
import {localizeProblem, retryMinutes} from '../src/components/auth/messages';
import {localizedChecks, passwordScore, strengthLevel} from '../src/components/auth/password-ui';
import {readStash, STASH_KEY, STASH_TTL_MS, writeStash} from '../src/components/auth/stash';
import {makeT} from '../src/lib/i18n/core';
import da from '../src/locales/da/auth.json';
import en from '../src/locales/en/auth.json';
import {isNewAccount, splitName, WELCOME_WINDOW_MS} from '../src/server/lib/onboarding';

const t = makeT({locale: 'en', catalogs: {auth: en}}, 'auth');
const tDa = makeT({locale: 'da', catalogs: {auth: da}, fallback: {auth: en}}, 'auth');

const answer = (status: number, headers: Record<string, string> = {}) => ({
  status,
  headers: {get: (n: string) => headers[n.toLowerCase()] ?? null},
});

describe('splitName', () => {
  it('splits at the first space', () => {
    expect(splitName('Mira Holm')).toEqual({firstName: 'Mira', lastName: 'Holm'});
    expect(splitName('Mira')).toEqual({firstName: 'Mira', lastName: ''});
    expect(splitName('Mary Ann Smith')).toEqual({firstName: 'Mary', lastName: 'Ann Smith'});
    expect(splitName('  Ida   Berg  ')).toEqual({firstName: 'Ida', lastName: 'Berg'});
  });
  it('empty names give empty strings', () => {
    expect(splitName('  ')).toEqual({firstName: '', lastName: ''});
    expect(splitName(null)).toEqual({firstName: '', lastName: ''});
    expect(splitName(undefined)).toEqual({firstName: '', lastName: ''});
  });
  it('clips to the column length', () => {
    expect(splitName(`${'a'.repeat(100)} b`).firstName).toHaveLength(80);
  });
});

describe('isNewAccount (welcome email window)', () => {
  const now = Date.UTC(2026, 10, 1);
  it('new accounts only', () => {
    expect(isNewAccount(new Date(now - 1000), now)).toBe(true);
    expect(isNewAccount(new Date(now - WELCOME_WINDOW_MS - 1), now)).toBe(false);
    expect(isNewAccount(null, now)).toBe(false);
  });
});

describe('password strength (VAREL PasswordStrength, 10-character threshold)', () => {
  it('scores length, digit and symbol', () => {
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('abcdefghi')).toBe(0);
    expect(passwordScore('abcdefghij')).toBe(1);
    expect(passwordScore('abcdefghi1')).toBe(2);
    expect(passwordScore('abcdefgh1!')).toBe(3);
    expect(passwordScore('ab1!')).toBe(2);
  });
  it('levels: 0 empty, 1 weak … 4 strong', () => {
    expect(strengthLevel('')).toBe(0);
    expect(strengthLevel('abc')).toBe(1);
    expect(strengthLevel('abcdefghij')).toBe(2);
    expect(strengthLevel('abcdefgh1!')).toBe(4);
  });
  it('checklist in the page language', () => {
    const checks = localizedChecks('short', 'mira@example.com', t);
    expect(checks.find(c => c.id === 'length')?.label).toBe('At least 10 characters');
    expect(checks.find(c => c.id === 'length')?.ok).toBe(false);
  });
});

describe('tokenFrom (pasted reset link)', () => {
  const token = 'A'.repeat(20) + '_-' + 'b'.repeat(21);
  it('reads a full URL, a fragment or the bare token', () => {
    expect(tokenFrom(`https://shop.example/account/reset/?token=${token}`)).toBe(token);
    expect(tokenFrom(`  /account/reset/?a=1&token=${token}  `)).toBe(token);
    expect(tokenFrom(`?token=${token}#x`)).toBe(token);
    expect(tokenFrom(token)).toBe(token);
    expect(TOKEN_RE.test(token)).toBe(true);
  });
  it('garbage is not a token', () => {
    expect(TOKEN_RE.test(tokenFrom('hello there'))).toBe(false);
    expect(TOKEN_RE.test(tokenFrom('https://shop.example/account/reset/'))).toBe(false);
  });
});

describe('localizeProblem', () => {
  it('no answer → network', () => {
    expect(localizeProblem(null, null, t).message).toBe(en.errors.network);
  });
  it('wrong email or password is one generic line on sign-in', () => {
    expect(localizeProblem(answer(401), {error: 'invalid_credentials', message: 'x'}, t).message).toBe(en.login.invalid);
    expect(localizeProblem(answer(422), {error: 'invalid_input', fields: {email: 'bad'}}, t, {login: true})).toEqual({
      ok: false,
      message: en.login.invalid,
    });
  });
  it('rate limits in minutes, rounded up, plural-aware', () => {
    expect(retryMinutes('61')).toBe(2);
    expect(retryMinutes(null)).toBe(1);
    expect(retryMinutes('0')).toBe(1);
    expect(localizeProblem(answer(429, {'retry-after': '30'}), {error: 'rate_limited'}, t).message).toBe(
      'Too many attempts. Try again in 1 minute.'
    );
    expect(localizeProblem(answer(429, {'retry-after': '600'}), {error: 'rate_limited'}, t).message).toBe(
      'Too many attempts. Try again in 10 minutes.'
    );
  });
  it('codes map to the page words, in its language', () => {
    expect(localizeProblem(answer(403), {error: 'registration_closed'}, t).message).toBe(en.signup.closed);
    expect(localizeProblem(answer(403), {error: 'email_unverified'}, tDa).message).toBe(da.errors.unverified);
    expect(localizeProblem(answer(400), {error: 'invalid_token'}, t, {invalidToken: 'X'}).message).toBe('X');
    expect(localizeProblem(answer(409), {error: 'email_taken'}, t, {emailTaken: 'Y'}).message).toBe('Y');
  });
  it('field errors land on their fields', () => {
    const r = localizeProblem(
      answer(422),
      {
        error: 'invalid_input',
        message: 'Check',
        fields: {email: 'Use an email address you can get mail at (no throwaway)', password: 'That password is too common.'},
      },
      t
    );
    expect(r.fields).toEqual({email: en.errors.emailNotReal, password: en.checks.common});
  });
  it('unknown problems keep the server message, else a generic one', () => {
    expect(localizeProblem(answer(409), {error: 'boom', message: 'Boom'}, t).message).toBe('Boom');
    expect(localizeProblem(answer(500), {error: 'server_error', message: 'Boom'}, t).message).toBe('Something went wrong (500). Try again.');
    expect(localizeProblem(answer(502), null, t).message).toBe('Something went wrong (502). Try again.');
  });
});

describe('sign-up stash', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      m,
    };
  };
  const extras = {email: ' Mira@Example.com ', firstName: 'Mira', lastName: 'Holm', newsletter: true};

  it('reads back for the same email only', () => {
    const store = memory();
    writeStash(extras, 1000, store);
    expect(readStash('mira@example.com', 2000, store)).toMatchObject({email: 'mira@example.com', firstName: 'Mira', newsletter: true});
    expect(readStash('other@example.com', 2000, store)).toBeNull();
    expect(store.m.has(STASH_KEY)).toBe(true);
  });
  it('expires after 48 hours and is cleared', () => {
    const store = memory();
    writeStash(extras, 1000, store);
    expect(readStash('mira@example.com', 1000 + STASH_TTL_MS + 1, store)).toBeNull();
    expect(store.m.has(STASH_KEY)).toBe(false);
  });
  it('survives broken or blocked storage', () => {
    const store = memory();
    store.setItem(STASH_KEY, '{nope');
    expect(readStash('mira@example.com', 1, store)).toBeNull();
    const fail = () => {
      throw new Error('blocked');
    };
    const blocked = {getItem: fail, setItem: fail, removeItem: () => {}};
    expect(() => writeStash(extras, 1, blocked)).not.toThrow();
    expect(readStash('mira@example.com', 1, blocked)).toBeNull();
    expect(readStash('mira@example.com', 1, null)).toBeNull();
  });
});

describe('richParts (VAREL <terms> strings, never HTML)', () => {
  it('splits text and links', () => {
    expect(richParts(en.login.legal, {terms: '/terms/', privacy: '/privacy/'})).toEqual([
      {text: 'By signing in you agree to our '},
      {text: 'terms', href: '/terms/'},
      {text: ' and '},
      {text: 'privacy policy', href: '/privacy/'},
      {text: '.'},
    ]);
  });
  it('unknown tags stay text', () => {
    expect(richParts('a <b>bold</b> <img>', {})).toEqual([{text: 'a '}, {text: 'bold'}, {text: ' <img>'}]);
  });
});
