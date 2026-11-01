/* Email providers with a mocked fetch (WP-22): request shape and headers, idempotency, failures and whether a retry can
   help, owner-set endpoint rules; the delivery settings rules; and the order/return/low-stock variable builders. */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {deliveryProblems, emailDeliveryPatch} from '../src/server/lib/email/delivery';
import {sendEzyStudio} from '../src/server/lib/email/ezystudio';
import {sendPostmark} from '../src/server/lib/email/postmark';
import {endpointProblem, type EmailProviderError, type OutgoingEmail} from '../src/server/lib/email/provider';
import {sendResend} from '../src/server/lib/email/resend';
import {
  addressLine,
  crossedThreshold,
  orderUrlOf,
  orderVars,
  paymentMethodOf,
  returnStatusLabel,
  type EmailOrderRow,
} from '../src/server/lib/email/triggers';
import {sendWebhook} from '../src/server/lib/email/webhook';

const msg: OutgoingEmail = {
  id: 42,
  from: {name: 'VAREL', email: 'care@varel.studio'},
  to: 'mira@studio.dk',
  replyTo: 'help@varel.studio',
  subject: 'Your order',
  html: '<p>h</p>',
  text: 't',
  template: 'order.confirmation',
  related: {type: 'order', id: '7'},
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(status: number, body: unknown) {
  const calls: {url: string; init: RequestInit}[] = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({url: String(url), init: init ?? {}});
    return new Response(status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body), {status});
  }) as typeof fetch;
  return calls;
}

const headersOf = (init: RequestInit) => new Headers(init.headers);
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>;
async function failure(p: Promise<unknown>): Promise<EmailProviderError> {
  try {
    await p;
  } catch (e) {
    return e as EmailProviderError;
  }
  throw new Error('expected a failure');
}

describe('resend', () => {
  it('posts the message with the key and an idempotency key', async () => {
    const calls = mockFetch(200, {id: 're_1'});
    expect(await sendResend(msg, {apiKey: 'k', config: {}})).toEqual({id: 're_1'});
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const h = headersOf(calls[0]!.init);
    expect(h.get('authorization')).toBe('Bearer k');
    expect(h.get('idempotency-key')).toBe('email-42');
    expect(bodyOf(calls[0]!.init)).toMatchObject({
      from: 'VAREL <care@varel.studio>',
      to: ['mira@studio.dk'],
      reply_to: 'help@varel.studio',
      tags: [{name: 'template', value: 'order_confirmation'}],
    });
  });
  it('says the key is missing, and that retrying cannot help', async () => {
    const e = await failure(sendResend(msg, {apiKey: null, config: {}}));
    expect(e.message).toBe("EMAIL_API_KEY is not added, so Resend cannot send. Add it in the dashboard's secrets.");
    expect(e.retryable).toBe(false);
    expect(e.config).toBe(true);
  });
  it('5xx and 429 can be retried, 4xx cannot', async () => {
    mockFetch(503, {message: 'down'});
    const a = await failure(sendResend(msg, {apiKey: 'k', config: {}}));
    expect(a.message).toBe('503 down');
    expect(a.retryable).toBe(true);
    mockFetch(429, {message: 'slow down'});
    expect((await failure(sendResend(msg, {apiKey: 'k', config: {}}))).retryable).toBe(true);
    mockFetch(422, {message: 'bad from'});
    const c = await failure(sendResend(msg, {apiKey: 'k', config: {}}));
    expect(c.retryable).toBe(false);
    expect(c.message).toBe('422 bad from');
  });
  it('a network failure or a timeout can be retried', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error('The operation timed out'), {name: 'TimeoutError'});
    }) as typeof fetch;
    const e = await failure(sendResend(msg, {apiKey: 'k', config: {}}));
    expect(e.message).toBe('Could not reach api.resend.com: timed out after 10 s');
    expect(e.retryable).toBe(true);
  });
});

describe('postmark', () => {
  it('posts with the server token, the stream and metadata', async () => {
    const calls = mockFetch(200, {ErrorCode: 0, MessageID: 'pm-1'});
    expect(await sendPostmark(msg, {apiKey: 'tok', config: {messageStream: 'broadcast'}})).toEqual({id: 'pm-1'});
    expect(calls[0]!.url).toBe('https://api.postmarkapp.com/email');
    expect(headersOf(calls[0]!.init).get('x-postmark-server-token')).toBe('tok');
    expect(bodyOf(calls[0]!.init)).toMatchObject({
      To: 'mira@studio.dk',
      MessageStream: 'broadcast',
      Tag: 'order.confirmation',
      Metadata: {relatedType: 'order', relatedId: '7'},
    });
  });
  it('defaults the stream to outbound and treats ErrorCode as a failure', async () => {
    const calls = mockFetch(200, {ErrorCode: 300, Message: 'Invalid email'});
    const e = await failure(sendPostmark(msg, {apiKey: 'tok', config: {}}));
    expect(e.message).toBe('300 Invalid email');
    expect(bodyOf(calls[0]!.init).MessageStream).toBe('outbound');
  });
});

describe('ezystudio and webhook', () => {
  const config = {endpoint: 'https://mail.ezystudio.dev/v1/messages'};
  it('ezystudio posts the generic body and needs an id back', async () => {
    const calls = mockFetch(200, {id: 77});
    expect(await sendEzyStudio(msg, {apiKey: 'k', config})).toEqual({id: '77'});
    expect(headersOf(calls[0]!.init).get('idempotency-key')).toBe('email-42');
    mockFetch(200, {});
    expect((await failure(sendEzyStudio(msg, {apiKey: 'k', config}))).message).toBe('The EzyStudio email service did not return a message id');
  });
  it('webhook sends the bearer only when a key is added', async () => {
    let calls = mockFetch(204, '');
    expect(await sendWebhook(msg, {apiKey: null, config: {endpoint: 'https://hooks.example.com/x'}})).toEqual({id: null});
    expect(headersOf(calls[0]!.init).get('authorization')).toBeNull();
    expect(headersOf(calls[0]!.init).get('idempotency-key')).toBe('email-42');
    calls = mockFetch(200, {id: 'w1'});
    await sendWebhook(msg, {apiKey: 'k', config: {endpoint: 'https://hooks.example.com/x'}});
    expect(headersOf(calls[0]!.init).get('authorization')).toBe('Bearer k');
  });
  it('refuses a missing endpoint and private or plain-http ones before calling', async () => {
    const calls = mockFetch(200, {id: 1});
    const missing = await failure(sendWebhook(msg, {apiKey: null, config: {}}));
    expect(missing.message).toMatch(/^Set an endpoint URL for .+ in Settings · Emails · Delivery$/);
    expect(missing.config).toBe(true);
    for (const endpoint of [
      'http://hooks.example.com/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'https://a.internal/x',
      'https://u:p@hooks.example.com/',
      'https://hooks.example.com:8443/',
    ]) {
      expect((await failure(sendWebhook(msg, {apiKey: null, config: {endpoint}}))).config, endpoint).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });
  it('endpointProblem accepts only https to a public name', () => {
    expect(endpointProblem('https://hooks.example.com/varel')).toBeNull();
    expect(endpointProblem('')).toBe('missing');
    expect(endpointProblem('https://[::1]/')).toBe('invalid');
    expect(endpointProblem('https://intranet/')).toBe('invalid');
  });
});

describe('delivery settings rules', () => {
  it('lower-cases addresses, empties to null, and checks the endpoint', () => {
    const ok = emailDeliveryPatch.parse({
      emailFromAddress: ' Care@Varel.Studio ',
      emailReplyTo: '',
      staffAlertEmail: null,
      emailConfig: {endpoint: '', messageStream: ''},
    });
    expect(ok).toEqual({emailFromAddress: 'care@varel.studio', emailReplyTo: null, staffAlertEmail: null, emailConfig: {}});
    expect(emailDeliveryPatch.safeParse({emailConfig: {endpoint: 'http://x.example.com'}}).success).toBe(false);
    expect(emailDeliveryPatch.safeParse({emailProvider: 'mailgun'}).success).toBe(false);
    expect(emailDeliveryPatch.safeParse({emailFromName: ' '}).success).toBe(false);
    expect(emailDeliveryPatch.safeParse({emailConfig: {other: 1}}).success).toBe(false);
  });
  it('requires an endpoint for ezystudio and webhook only', () => {
    expect(deliveryProblems('webhook', {})).toEqual({'emailConfig.endpoint': 'Use a full link starting with https://'});
    expect(deliveryProblems('ezystudio', {endpoint: 'https://mail.ezystudio.dev/v1'})).toBeNull();
    expect(deliveryProblems('resend', {})).toBeNull();
  });
});

describe('order variables', () => {
  const order = (over: Record<string, unknown> = {}): EmailOrderRow =>
    ({
      id: 7,
      number: 'VRL-24817',
      email: 'mira@studio.dk',
      userId: null,
      currency: 'USD',
      address: {name: 'Mira Holm', line1: 'Vesterbrogade 1', line2: null, city: 'København', zip: '1620', country: 'DK'},
      subtotalCents: 88400,
      discountCents: 2500,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 85900,
      pricesIncludeTax: false,
      method: 'Standard',
      carrier: null,
      tracking: null,
      trackingUrl: null,
      cardBrand: 'visa',
      cardLast4: '4242',
      items: [{id: 1, name: 'Atelier wool coat', color: 'Stone', size: 'M', options: {}, qty: 2, priceCents: 29400, discountCents: 2500, digital: false}],
      user: null,
      ...over,
    }) as unknown as EmailOrderRow;

  it('formats cents, the discount sign, free shipping and an empty tax', () => {
    const v = orderVars(order(), 'https://varel.studio');
    expect(v).toMatchObject({
      firstName: 'Mira',
      orderNumber: 'VRL-24817',
      orderUrl: 'https://varel.studio/order/VRL-24817/confirmation/?email=mira%40studio.dk',
      subtotal: '$884',
      discount: '−$25',
      shipping: 'Free',
      tax: '',
      total: '$859',
      paymentMethod: 'Visa ending 4242',
      shippingAddress: 'Mira Holm, Vesterbrogade 1, 1620 København, DK',
    });
    expect(v.items).toEqual([{name: 'Atelier wool coat', meta: 'Stone · M', qty: 2, total: '$563'}]);
    expect('taxLabel' in v).toBe(false);
  });
  it('labels included tax and prefers the profile first name', () => {
    const v = orderVars(order({pricesIncludeTax: true, taxCents: 1234, user: {customerProfile: {firstName: 'Ida'}}}), '');
    expect(v).toMatchObject({taxLabel: 'Includes tax', tax: '$12.34', firstName: 'Ida', orderUrl: ''});
  });
  it('links account orders and guest confirmations with a trailing slash', () => {
    expect(orderUrlOf('https://v.dk', {number: 'VRL-1', email: 'a@b.co', userId: 3})).toBe('https://v.dk/account/orders/VRL-1/');
    expect(orderUrlOf('https://v.dk', {number: 'VRL-1', email: 'a+b@c.co', userId: null})).toBe(
      'https://v.dk/order/VRL-1/confirmation/?email=a%2Bb%40c.co'
    );
  });
  it('digital orders have no address line; unknown cards no payment method', () => {
    expect(addressLine(null)).toBe('');
    expect(addressLine({name: 'x'})).toBe('');
    expect(paymentMethodOf(null, null)).toBe('');
    expect(paymentMethodOf('amex', '0005')).toBe('American Express ending 0005');
  });
  it('maps return statuses to the words the email uses', () => {
    expect(returnStatusLabel('Rejected')).toBe('declined');
    expect(returnStatusLabel('Requested')).toBe('reopened');
    expect(returnStatusLabel('Approved')).toBe('approved');
  });
  it('low stock: only variants this order took across the threshold', () => {
    const variants = [
      {id: 'a', inventory: 5},
      {id: 'b', inventory: 2},
      {id: 'c', inventory: 10},
      {id: 'd', inventory: null},
    ];
    const lines = [
      {variantId: 'a', qty: 2},
      {variantId: 'b', qty: 1},
      {variantId: 'c', qty: 1},
      {variantId: 'd', qty: 9},
    ];
    expect(crossedThreshold(variants, lines, 6).map(v => v.id)).toEqual(['a']);
  });
});
