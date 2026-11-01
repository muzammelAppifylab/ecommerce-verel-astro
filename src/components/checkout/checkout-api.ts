/* Checkout calls from the browser (port of VAREL src/pages/checkout/payments.ts + the cart/shipping hooks it used),
   without TanStack Query: plain functions over the storefront API client (`siteFetch`, CSRF, X-Locale).
   Reads take an AbortSignal so the latest country / method / email wins. Paths are relative to /site-api. */
import {api} from '@/lib/storefront-api';
import type {Cart, DiscountContext, Totals} from '@/lib/types/cart';
import type {CheckoutConfig, CheckoutRequest, CheckoutResponse, Order, ShippingMethodsResponse} from '@/lib/types/orders';

const enc = encodeURIComponent;

/** GET /checkout/config: the payment provider checkout uses right now. */
export const getCheckoutConfig = (signal?: AbortSignal) => api.get<CheckoutConfig>('/checkout/config', undefined, signal);

/** POST /checkout: place the order (201 {order, payment}). */
export const placeOrder = (input: CheckoutRequest) => api.post<CheckoutResponse>('/checkout', input);

/** Ask the server to check a Pending Stripe order with Stripe (webhooks can lag). */
export const syncOrder = (number: string, email?: string) =>
  api.post<{order: Order}>(`/checkout/${enc(number)}/sync`, email ? {email} : {});

/** Give up on a Stripe payment: releases the order and puts its pieces back in the bag. */
export const cancelOrderPayment = (number: string, email?: string) =>
  api.post<{order: Order; restored: boolean} | undefined>(`/checkout/${enc(number)}/cancel`, email ? {email} : {});

/** Abandoned-bag email capture. Best effort: a missing endpoint or any error is ignored. */
export function captureCartEmail(email: string): void {
  api.post('/cart/email', {email}).catch(() => undefined);
}

/** GET /cart */
export const getCart = (signal?: AbortSignal) => api.get<Cart>('/cart', undefined, signal);

/** GET /cart/totals?country&method&email: live totals for the checkout choices. */
export const getTotals = (
  q: {country?: string | null; method?: string | null; email?: string | null},
  signal?: AbortSignal
) => api.get<Totals>('/cart/totals', {country: q.country, method: q.method, email: q.email}, signal);

/** GET /shipping/methods?country= */
export const getShippingMethods = (country: string, signal?: AbortSignal) =>
  api.get<ShippingMethodsResponse>('/shipping/methods', {country}, signal);

/** POST /cart/discount (with the checkout context, so the code is judged as checkout will). */
export const applyDiscount = (code: string, context?: DiscountContext) =>
  api.post<Cart>('/cart/discount', context ? {code, ...context} : {code});

/** DELETE /cart/discount */
export const removeDiscount = () => api.del<Cart>('/cart/discount');
