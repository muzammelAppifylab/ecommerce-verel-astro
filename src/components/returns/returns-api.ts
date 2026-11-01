/* Returns page → Site API (VAREL src/lib/api/hooks.ts useReturnLookup / useCreateReturn) through F4's storefront
   `api` (siteFetch: cookies, CSRF, one refresh on 401 token_expired, X-Locale). */
import {api} from '@/lib/storefront-api';
import type {CreateReturnInput, CreateReturnResponse, ReturnLookupResponse} from '@/lib/types/orders';

/** How the server let the caller see the order: its owner, the order's email, or the number alone (redacted:
    booking a return then needs the email). */
export type ReturnAccess = 'owner' | 'email' | 'number';
export type ReturnLookupResult = ReturnLookupResponse & {access?: ReturnAccess};

/** Longest order number / email the page accepts from the URL or the form. */
export const ORDER_MAX = 20;
export const EMAIL_MAX = 254;

export const lookupReturn = (order: string, email?: string) =>
  api.post<ReturnLookupResult>('/returns/lookup', {order, ...(email ? {email} : {})});

/** `items[].lineId` goes as the number the server stores (`shop_order_items.id`). */
export const createReturn = (input: Omit<CreateReturnInput, 'items'> & {items: {lineId: string; qty: number; reason: string}[]}) =>
  api.post<CreateReturnResponse>('/returns', {
    order: input.order,
    ...(input.email ? {email: input.email} : {}),
    items: input.items.map(i => ({lineId: /^\d+$/.test(i.lineId) ? Number(i.lineId) : i.lineId, qty: i.qty, reason: i.reason})),
  });

/** `?order=` / `?email=` from the address bar, trimmed and bounded ('' when absent or too long). */
export function readReturnParams(search: string): {order: string; email: string} {
  const sp = new URLSearchParams(search);
  const order = (sp.get('order') ?? '').trim();
  const email = (sp.get('email') ?? '').trim();
  return {order: order.length <= ORDER_MAX ? order : '', email: email.length <= EMAIL_MAX ? email : ''};
}

/** A simple shape check for the email field (the server matches it to the order). */
export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
