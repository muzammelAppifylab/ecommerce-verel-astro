/*
 * The bag page body (`/cart/`, WP-09): port of VAREL src/pages/Cart.tsx. The page renders it on the server with the
 * bag it read in-process (`initialCart`), so the first paint is the real bag; after hydration it reads and writes
 * through the bag store (./cart-store), shared with the drawer and every add-to-bag on the page.
 *
 * States: loading (only while a retry runs after a failed server read), error (with Try again), empty, content.
 * Related pieces ("Wears well with") are those of the first line: the server's answer first, re-read when the first
 * line changes (hidden on error or when there are none).
 */
import {useEffect, useRef, useState} from 'react';

import {Breadcrumb} from '@/components/varel/Breadcrumb';
import {Button} from '@/components/varel/Button';
import {Container} from '@/components/varel/Container';
import {EmptyState} from '@/components/varel/EmptyState';
import {Icon} from '@/components/varel/Icon';
import {Img} from '@/components/varel/Img';
import {QuantityStepper} from '@/components/varel/QuantityStepper';
import {Skeleton} from '@/components/varel/Skeleton';
import {TextProvider, useLocale, type Dicts} from '@/components/varel/text';
import {checkoutLink, homeLink, productLink, shopLink} from '@/lib/links';
import {lineStock} from '@/lib/product';
import {api, errorMessage} from '@/lib/storefront-api';
import type {AppliedDiscountSummary, Cart as CartData, CartLine} from '@/lib/types/cart';
import type {Product} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {cartStore, removeDiscount, removeLine, updateLine, useCart} from './cart-store';
import {DiscountForm} from './DiscountForm';
import {appliedDiscounts, LineDiscountNote, lineDiscountNote, LinePrice, SavingsLine} from './discounts';
import {money, priceText} from './money';
import {asTFunction, useCartText} from './text';
import {TotalLine, TotalsTable} from './TotalsTable';
import {LABEL, LABEL_HEADING, lineMeta, PAGE_TITLE, SOLID_CTA, UNDERLINE_LINK} from './ui';

/** What the related list shows per piece (GET /site-api/products/:slug/related). */
export type RelatedProduct = Pick<Product, 'id' | 'name' | 'image' | 'alt' | 'price'>;

export interface CartPageProps {
  /** The bag the server read for this visitor; null when that read failed (the page answered 503) */
  initialCart: CartData | null;
  /** Related pieces of the first line, read on the server; null when unknown */
  initialRelated?: RelatedProduct[] | null;
  /** Catalogs: cart, checkout, product (stock), layout (stepper labels), common */
  dicts: Dicts;
  locale: string;
}

/** Desktop column template: Item · details · Quantity · Total · remove */
const ROW_COLS = 'md:grid-cols-[96px_minmax(0,1fr)_130px_110px_40px] md:gap-5';

export default function CartPage({initialCart, initialRelated = null, dicts, locale}: CartPageProps) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <CartView initialCart={initialCart} initialRelated={initialRelated} />
    </TextProvider>
  );
}

export {CartPage};

function CartView({initialCart, initialRelated}: {initialCart: CartData | null; initialRelated: RelatedProduct[] | null}) {
  const t = useCartText('cart');
  const locale = useLocale();
  const state = useCart();
  const [hydrated, setHydrated] = useState(false);

  // The server's bag becomes the store's (fresh, no refetch); a failed server read is retried once in the browser.
  useEffect(() => {
    if (initialCart) cartStore.hydrate(initialCart);
    else void cartStore.load({force: true});
    setHydrated(true);
  }, [initialCart]);

  // Before hydration (and on the server) the page shows the bag it was rendered with.
  const cart = hydrated ? (state.cart ?? initialCart) : initialCart;
  const loading = !cart && hydrated && state.status === 'loading';
  const failed = !cart && !loading;
  const count = cart?.totals.count ?? 0;

  return (
    <div className="mx-auto w-full max-w-page">
      <Container className="pt-6">
        <Breadcrumb items={[{label: t('crumbs.home'), href: homeLink(locale)}, {label: t('crumbs.bag')}]} />
      </Container>

      <Container as="header" className="flex items-baseline gap-5 pt-6 pb-8">
        <h1 className={PAGE_TITLE}>{t('title')}</h1>
        {cart && <span className={cn(LABEL, 'text-label-md text-text-muted')}>{t('count', {count})}</span>}
      </Container>

      {loading ? (
        <CartSkeleton />
      ) : failed ? (
        <Container className="pb-24">
          <EmptyState
            title={t('loadError')}
            description={state.error ? errorMessage(state.error) : undefined}
            action={
              <Button
                variant="outline"
                loading={state.status === 'loading'}
                loadingLabel={t('loading')}
                onClick={() => void cartStore.load({force: true})}>
                {t('tryAgain')}
              </Button>
            }
          />
        </Container>
      ) : cart!.lines.length === 0 ? (
        <Container className="pb-24">
          <EmptyState
            title={t('empty.title')}
            description={t('empty.description')}
            action={
              <a href={shopLink(locale)} className={cn(SOLID_CTA, 'px-[26px] py-[15px]')}>
                {t('continueShopping')}
              </a>
            }
          />
        </Container>
      ) : (
        <CartContent cart={cart!} initialRelated={initialRelated} />
      )}
    </div>
  );
}

/** Related pieces of the first line: the server's list for the line it rendered, re-read when that line changes. */
function useRelated(productId: string | undefined, initial: RelatedProduct[] | null): RelatedProduct[] | null {
  const first = useRef(productId);
  const [list, setList] = useState<RelatedProduct[] | null>(initial);
  useEffect(() => {
    if (!productId) {
      setList(null);
      return;
    }
    if (productId === first.current && initial) return;
    first.current = undefined;
    const ctl = new AbortController();
    api
      .get<RelatedProduct[]>(`/products/${encodeURIComponent(productId)}/related`, {limit: 3}, ctl.signal)
      .then(r => setList(Array.isArray(r) ? r.slice(0, 3) : null))
      .catch(() => {
        if (!ctl.signal.aborted) setList(null);
      });
    return () => ctl.abort();
  }, [productId, initial]);
  return list;
}

function CartContent({cart, initialRelated}: {cart: CartData; initialRelated: RelatedProduct[] | null}) {
  const tr = useCartText('cart');
  const tCheckout = useCartText('checkout');
  const locale = useLocale();
  const t = cart.totals;
  const related = useRelated(cart.lines[0]?.productId, initialRelated);
  const [removingCode, setRemovingCode] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const list = appliedDiscounts(t, tCheckout);
  const freeShipNote = t.toFree > 0 ? tr('toFree', {amount: money(t.toFree)}) : tr('freeApplied');

  const onRemoveCode = () => {
    if (removingCode) return;
    setRemovingCode(true);
    removeDiscount()
      .catch(() => undefined)
      .finally(() => setRemovingCode(false));
  };

  const onRemoveLine = (lineId: string) => {
    if (removingId) return;
    setRemovingId(lineId);
    removeLine(lineId)
      .catch(() => undefined)
      .finally(() => setRemovingId(null));
  };

  return (
    <Container className="grid grid-cols-1 items-start gap-12 pb-24 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col">
        <div className={cn(LABEL, 'hidden border-b border-strong pb-3.5 text-text-muted md:grid', ROW_COLS)}>
          <span>{tr('columns.item')}</span>
          <span />
          <span>{tr('columns.quantity')}</span>
          <span className="text-right">{tr('columns.total')}</span>
          <span />
        </div>
        <ul className="m-0 list-none border-t border-strong p-0 md:border-t-0">
          {cart.lines.map(l => (
            <CartRow
              key={l.lineId}
              line={l}
              discounts={list}
              removing={removingId === l.lineId}
              busy={removingId !== null}
              onRemove={() => onRemoveLine(l.lineId)}
            />
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-6 pt-7">
          <a href={shopLink(locale)} className={UNDERLINE_LINK}>
            {tr('continueShopping')}
          </a>
          <span className="text-body-xs text-text-muted">{freeShipNote}</span>
        </div>

        {related && related.length > 0 && (
          <section className="mt-16 flex flex-col gap-6 border-t border-hairline pt-10">
            <h2 className="m-0 font-display text-[30px] font-normal">{tr('related')}</h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              {related.map(r => (
                <a
                  key={r.id}
                  href={productLink(r.id, locale)}
                  data-card="true"
                  className="flex min-w-0 items-center gap-3.5 border-0 text-text-primary hover:text-text-primary">
                  <span className="block w-[72px] flex-[0_0_72px] overflow-hidden">
                    <Img photo={r.image} alt={r.alt} width={200} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <span data-name="true" className="self-start font-display text-[18px] leading-display">
                      {r.name}
                    </span>
                    <span className="text-body-xs text-text-muted">{priceText(r.price, locale)}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside aria-label={tr('summaryLabel')} className="flex flex-col gap-[22px] border border-hairline p-6 md:p-8 lg:sticky lg:top-24">
        <h2 className={cn(LABEL_HEADING, 'text-text-primary')}>{tr('summary')}</h2>
        <TotalsTable
          subtotal={t.subtotal}
          discount={t.discount}
          discountCode={t.discountCode}
          discounts={list}
          onRemoveCode={onRemoveCode}
          removing={removingCode}
          shippingLabel={t.shippingLabel}
          tax={t.tax}
          taxName={t.taxName}
          taxRate={t.taxRate}
          pricesIncludeTax={t.pricesIncludeTax}
          physical={t.physical}
        />
        <div className="flex flex-col gap-3">
          <TotalLine total={t.total} />
          <SavingsLine amount={t.discount} className="self-end" />
        </div>
        <DiscountForm cart={cart} id="cart-code" />
        <a href={checkoutLink(locale)} className={cn(SOLID_CTA, 'px-6 py-[17px]')}>
          {tr('checkout')}
        </a>
        <p className="m-0 text-[12px] leading-body text-text-muted">{tr('taxNote', {tax: t.taxName})}</p>
      </aside>
    </Container>
  );
}

function CartRow({
  line: l,
  discounts,
  removing,
  busy,
  onRemove,
}: {
  line: CartLine;
  discounts: AppliedDiscountSummary[];
  removing: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const t = useCartText('cart');
  const tCheckout = useCartText('checkout');
  const tProduct = useCartText('product');
  const locale = useLocale();
  const stock = lineStock(l, asTFunction(tProduct));
  const max = l.digital ? 1 : Math.max(1, l.inventory ?? 9);
  const href = productLink(l.productId, locale);

  return (
    <li className={cn('grid grid-cols-[80px_minmax(0,1fr)_32px] items-start gap-x-4 gap-y-4 border-b border-hairline py-6', ROW_COLS)}>
      <a href={href} aria-label={l.name} className="row-span-2 block w-20 border-0 md:row-span-1 md:w-24">
        <Img photo={l.image} alt={l.alt} width={240} media={false} />
      </a>
      <div className="col-start-2 flex min-w-0 flex-col gap-2">
        <a href={href} className="self-start border-0 font-display text-[22px] leading-display text-text-primary">
          {l.name}
        </a>
        <span className="text-body-xs text-text-muted">{lineMeta(l, tCheckout)}</span>
        <span className="text-[12px] text-text-muted">{t('skuEach', {sku: l.sku, price: priceText(l.unit, locale)})}</span>
        <span className={cn(LABEL, stock.className)}>{stock.label}</span>
        {l.discount > 0 && <LineDiscountNote>{lineDiscountNote(l, discounts, tCheckout)}</LineDiscountNote>}
      </div>
      <div className="col-span-2 col-start-2 flex items-center justify-between gap-4 md:contents">
        <span className="md:col-start-3 md:row-start-1">
          <QuantityStepper
            value={l.qty}
            min={1}
            max={max}
            disabled={l.digital || removing}
            itemLabel={l.name}
            onChange={qty => {
              if (qty !== l.qty) void updateLine(l.lineId, qty).catch(() => undefined);
            }}
          />
        </span>
        <LinePrice
          total={l.total}
          discount={l.discount}
          locale={locale}
          className="text-[15px] md:col-start-4 md:row-start-1 md:justify-self-end"
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-busy={removing || undefined}
        aria-label={t('remove', {name: l.name})}
        className="col-start-3 row-start-1 flex justify-center border-0 bg-transparent p-1 text-text-muted transition-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-48 md:col-start-5">
        <Icon name="x" size={17} />
      </button>
    </li>
  );
}

function CartSkeleton() {
  return (
    <Container className="grid grid-cols-1 items-start gap-12 pb-24 lg:grid-cols-[minmax(0,1fr)_400px]" aria-busy="true">
      <div className="flex flex-col">
        {[0, 1, 2].map(i => (
          <div key={i} className="grid grid-cols-[96px_1fr] gap-5 border-b border-hairline py-6">
            <Skeleton className="aspect-[3/4] w-24" />
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-3.5 w-1/4" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-[420px] w-full" />
    </Container>
  );
}
