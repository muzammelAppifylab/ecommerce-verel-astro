/* Email templates: substitution, sections, escaping, markup blocks and the plain-text alternative (port of VAREL
   tests/email.test.ts, WP-22), plus the admin helpers (section balance, sample data, unknown variables). */
import {describe, expect, it} from 'vitest';

import {cleanVars, sectionProblem, unknownVariables} from '../src/server/lib/email/admin';
import {ACTIVE_TEMPLATE_KEYS, CUSTOMER_TEMPLATE_KEYS, TEMPLATE_DEFAULTS, templateDefault} from '../src/server/lib/email/defaults';
import {genericBody} from '../src/server/lib/email/ezystudio';
import {formatAddress} from '../src/server/lib/email/provider';
import {renderEmail} from '../src/server/lib/email/render';
import {maskEmail, validRecipient} from '../src/server/lib/email/send';
import {expand, resolve, substitute} from '../src/server/lib/email/template';

const brand = {storeName: 'VAREL', supportEmail: 'care@varel.studio', siteUrl: 'https://varel.studio'};
const r = (body: string, vars: Record<string, unknown> = {}) => renderEmail({subject: 's', body}, vars as never, brand);

describe('substitution', () => {
  it('replaces variables and leaves unknown ones empty', () => {
    expect(substitute('Order {{orderNumber}} for {{ firstName }}{{missing}}', {orderNumber: 'VRL-1', firstName: 'Mira'})).toBe('Order VRL-1 for Mira');
  });
  it('repeats row blocks and reads row fields first', () => {
    const {text, values} = expand('{{#items}}{{name}}×{{qty}};{{/items}}', {items: [{name: 'Coat', qty: 1}, {name: 'Knit', qty: 2}]});
    expect(resolve(text, values)).toBe('Coat×1;Knit×2;');
  });
  it('renders sections once for truthy values and inverted sections for empty ones', () => {
    const t = '{{#url}}track{{/url}}{{^url}}order{{/url}}';
    expect(substitute(t, {url: 'https://x'})).toBe('track');
    expect(substitute(t, {url: ''})).toBe('order');
    expect(substitute(t, {})).toBe('order');
  });
  it('drops section tags that stand alone on a line', () => {
    const {text, values} = expand('a\n{{#items}}\n{{name}}\n{{/items}}\nb', {items: [{name: 'x'}]});
    expect(resolve(text, values)).toBe('a\nx\nb');
  });
});

describe('html', () => {
  it('escapes values and never turns them into markup', () => {
    const {html, text} = r('Hello {{name}}\n\n{{x}} | {{y}}', {name: '<b>Mira</b> **bold**', x: 'a | b', y: '[c](https://evil)'});
    expect(html).toContain('&lt;b&gt;Mira&lt;/b&gt; **bold**');
    expect(html).not.toContain('<b>Mira');
    expect(html).not.toContain('href="https://evil"');
    expect(text).toContain('a | b: [c](https://evil)');
  });
  it('renders buttons, headings, rules and notes', () => {
    const {html, text} = r('# Hi\n\n---\n\n[Go]({{url}})\n\n> small', {url: 'https://varel.studio/x'});
    expect(html).toContain('href="https://varel.studio/x"');
    expect(html).toContain('>Hi</td>');
    expect(text).toContain('Go: https://varel.studio/x');
    expect(text).toContain('small');
  });
  it('drops buttons without a link and table rows without a value', () => {
    const {html, text} = r('[Track]({{trackingUrl}})\n\nSubtotal | {{subtotal}}\nDiscount | {{discount}}', {subtotal: '$10', discount: ''});
    expect(html).not.toContain('Track');
    expect(text).toContain('Subtotal: $10');
    expect(text).not.toContain('Discount');
  });
  it('refuses javascript: links', () => {
    const {html} = r('[Go]({{u}})', {u: 'javascript:alert(1)'});
    expect(html).not.toContain('javascript:');
  });
  it('uses the type-set wordmark, no images', () => {
    const {html} = r('Hello');
    expect(html).toContain('letter-spacing:0.42em');
    expect(html).not.toMatch(/<img/i);
  });
  it('sets the message language on <html lang>, falling back to en', () => {
    expect(renderEmail({subject: 's', body: 'x'}, {}, {...brand, lang: 'da'}).html).toContain('<html lang="da"');
    expect(renderEmail({subject: 's', body: 'x'}, {}, {...brand, lang: '"><script>'}).html).toContain('<html lang="en"');
  });
  it('collapses newlines in the subject and falls back to the store name', () => {
    expect(renderEmail({subject: 'a\nb', body: 'x'}, {}, brand).subject).toBe('a b');
    expect(renderEmail({subject: '{{none}}', body: 'x'}, {}, brand).subject).toBe('VAREL');
  });
});

describe('defaults', () => {
  it('every template renders its sample without leftover tags or exclamation marks', () => {
    for (const t of TEMPLATE_DEFAULTS) {
      const out = renderEmail(t, t.sample, brand);
      expect(out.html, `${t.key} html`).not.toContain('{{');
      expect(out.text, `${t.key} text`).not.toContain('{{');
      expect(/!/.test(t.subject + t.body), `${t.key} has an exclamation mark`).toBe(false);
      expect(out.subject.length).toBeGreaterThan(0);
    }
  });
  it('retires the account emails the platform sends and staff invites', () => {
    expect(templateDefault('password_reset')?.retired).toBe(true);
    expect(templateDefault('staff_invite')?.retired).toBe(true);
    expect(ACTIVE_TEMPLATE_KEYS).toHaveLength(9);
    expect(ACTIVE_TEMPLATE_KEYS).not.toContain('password_reset');
    expect(CUSTOMER_TEMPLATE_KEYS).not.toContain('low_stock_alert');
    expect(CUSTOMER_TEMPLATE_KEYS).toContain('order_confirmation');
  });
  it('sample links use this site’s paths with a trailing slash', () => {
    expect(String(templateDefault('order_shipped')?.sample.orderUrl)).toMatch(/\/account\/orders\/VRL-24817\/$/);
    expect(String(templateDefault('low_stock_alert')?.sample.inventoryUrl)).toContain('/dashboard/inventory');
  });
});

describe('ezystudio contract', () => {
  it('builds the documented body', () => {
    const b = genericBody({
      from: {name: 'VAREL', email: 'care@varel.studio'},
      to: 'mira@studio.dk',
      replyTo: null,
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
      template: 'welcome',
      related: {type: 'user', id: 'u1'},
    });
    expect(b).toEqual({
      from: {name: 'VAREL', email: 'care@varel.studio'},
      to: [{email: 'mira@studio.dk'}],
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
      tags: ['welcome'],
      metadata: {relatedType: 'user', relatedId: 'u1'},
    });
  });
});

describe('admin helpers', () => {
  it('names the unbalanced section tag', () => {
    expect(sectionProblem('{{#items}}x{{/items}}')).toBeNull();
    expect(sectionProblem('{{#items}}x')).toBe('{{#items}} is not closed with {{/items}}');
    expect(sectionProblem('x{{/items}}')).toBe('{{/items}} has no matching {{#items}}');
    expect(sectionProblem('{{#a}}{{#b}}{{/a}}')).toBe('{{/a}} has no matching {{#a}}');
  });
  it('keeps scalars, turns arrays of objects into rows and drops the rest', () => {
    const rows = Array.from({length: 80}, (_, i) => ({name: `n${i}`, qty: i, nested: {x: 1}, none: null}));
    const out = cleanVars({a: 'x', b: 2, c: true, d: null, e: {x: 1}, items: [...rows, 'junk', [1]], long: 'y'.repeat(5000)});
    expect(out.a).toBe('x');
    expect(out.b).toBe(2);
    expect(out.c).toBe(true);
    expect(out.d).toBeNull();
    expect('e' in out).toBe(false);
    const items = out.items as Record<string, unknown>[];
    expect(items).toHaveLength(50);
    expect(items[0]).toEqual({name: 'n0', qty: 0, nested: '[object Object]', none: null});
    expect(String(out.long)).toHaveLength(2000);
    expect(Object.keys(cleanVars(Object.fromEntries(Array.from({length: 150}, (_, i) => [`k${i}`, i]))))).toHaveLength(100);
  });
  it('flags variables that are neither documented nor in a sample row', () => {
    const d = templateDefault('order_shipped')!;
    expect(unknownVariables(d, {subject: '{{orderNumber}}', body: '{{#items}}{{name}}{{/items}} {{storeName}} {{nope}}'}, d.sample as never)).toEqual(['nope']);
  });
});

describe('addresses', () => {
  it('quotes sender names that need it', () => {
    expect(formatAddress({name: 'VAREL', email: 'care@varel.studio'})).toBe('VAREL <care@varel.studio>');
    expect(formatAddress({name: 'VAREL, Studio', email: 'a@b.co'})).toBe('"VAREL, Studio" <a@b.co>');
    expect(formatAddress({name: 'Say "hi"', email: 'a@b.co'})).toBe('"Say \\"hi\\"" <a@b.co>');
    expect(formatAddress({name: ' ', email: 'a@b.co'})).toBe('a@b.co');
  });
  it('checks recipients and masks them in logs', () => {
    expect(validRecipient('mira@studio.dk')).toBe(true);
    expect(validRecipient('mira@studio')).toBe(false);
    expect(validRecipient(`${'a'.repeat(250)}@b.co`)).toBe(false);
    expect(maskEmail('mira@studio.dk')).toBe('m***@studio.dk');
  });
});
