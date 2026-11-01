/* The wishlist page body (VAREL src/pages/Wishlist.tsx), one island (`client:load`): breadcrumb, header with
   the count and the two actions, the saved pieces, the empty / error states and the suggestions.
   The page reads the list on the server (`initial`); the shared bag store (src/lib/stores/bag.ts) then owns the
   saved ids, so a heart removed here (or "Add all in stock") drops the tile and the header count at once. */
import {useEffect, useMemo, useState} from 'react';

import {Breadcrumb} from '@/components/varel/Breadcrumb';
import {Button} from '@/components/varel/Button';
import {Container} from '@/components/varel/Container';
import {EmptyState} from '@/components/varel/EmptyState';
import {localizeHref} from '@/components/varel/href';
import {ProductGridSkeleton} from '@/components/varel/ProductGrid';
import {Spinner} from '@/components/varel/Spinner';
import {type Dicts, TextProvider, useLocale, useText} from '@/components/varel/text';
import {notifyError} from '@/components/varel/Toast';
import {bag, useBag} from '@/lib/stores/bag';
import {errorMessage, request} from '@/lib/storefront-api';
import type {Product} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {getWishlist, moveToBag, type WishlistResponse} from './api';
import {type SuggestionCandidate, Suggestions} from './Suggestions';
import {LABEL, PAGE_TITLE, SOLID_CTA} from './ui';
import {useFlash} from './use-flash';
import {WishTile} from './WishTile';

export interface WishlistPageProps {
  locale: string;
  /** `wishlist`, `product`, `common` and `layout` (breadcrumb label) catalogs */
  dicts: Dicts;
  /** The server's read of GET /site-api/wishlist: `null` when it failed (error state), `undefined` to read it here */
  initial?: WishlistResponse | null;
  /** Server message of the failed read, shown under the error title */
  errorText?: string | null;
  /** The first products of the default listing, trimmed (suggestions) */
  candidates: SuggestionCandidate[];
}

export default function WishlistPage(props: WishlistPageProps) {
  return (
    <TextProvider locale={props.locale} dicts={props.dicts}>
      <Wishlist {...props} />
    </TextProvider>
  );
}

type Load = {state: 'loading'} | {state: 'error'; message: string} | {state: 'ready'; items: Product[]};

function Wishlist({initial, errorText, candidates}: WishlistPageProps) {
  const t = useText('wishlist');
  const common = useText('common');
  const locale = useLocale();
  const store = useBag();
  const [load, setLoad] = useState<Load>(() =>
    initial === undefined
      ? {state: 'loading'}
      : initial === null
        ? {state: 'error', message: errorText || common('error')}
        : {state: 'ready', items: initial.items}
  );
  // Until mounted, the saved ids are the server's (the store is empty during server render and hydration).
  const [mounted, setMounted] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [moving, setMoving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [addedAll, flashAll] = useFlash(1800);

  const adopt = (data: WishlistResponse) => {
    bag.setWishlist(data.ids);
    setLoad({state: 'ready', items: data.items});
  };

  const fetchList = () =>
    getWishlist().then(adopt, (error: unknown) => setLoad({state: 'error', message: errorMessage(error, common('error'))}));

  useEffect(() => {
    // The server's list is the truth for this view: hand its ids to the store (header count, hearts).
    if (initial) bag.setWishlist(initial.ids);
    else if (initial === undefined) void fetchList();
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ids = mounted ? store.wishlist : (initial?.ids ?? []);
  const items = useMemo(() => {
    if (load.state !== 'ready') return [];
    const saved = new Set(ids);
    return load.items.filter(p => saved.has(p.id));
  }, [load, ids]);
  const n = items.length;
  const ready = load.state === 'ready';

  const retry = () => {
    setRetrying(true);
    void fetchList().finally(() => setRetrying(false));
  };

  const remove = (id: string) =>
    bag.toggleWishlist(id, false).catch((error: unknown) => notifyError(errorMessage(error, common('error'))));

  const addAll = () => {
    if (moving) return;
    setMoving(true);
    moveToBag()
      .then(res => {
        bag.applyCart(res.cart);
        bag.setWishlist(res.ids);
        flashAll();
      })
      .catch((error: unknown) => notifyError(errorMessage(error, common('error'))))
      .finally(() => setMoving(false));
  };

  // VAREL removed every piece in parallel, without a confirmation (re-adding is one click away).
  const clearAll = () => {
    if (clearing) return;
    const removing = items.map(p => p.id);
    const gone = new Set(removing);
    setClearing(true);
    bag.setWishlist(bag.get().wishlist.filter(id => !gone.has(id)));
    void Promise.allSettled(
      removing.map(id => request<{ids: string[]}>(`/wishlist/${encodeURIComponent(id)}`, {method: 'DELETE'}))
    )
      .then(async results => {
        // Parallel answers can arrive out of order: settle on one fresh read of the ids.
        const fresh = await request<{ids: string[]}>('/wishlist/ids').catch(() => null);
        if (fresh) bag.setWishlist(fresh.ids);
        const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed) notifyError(errorMessage(failed.reason, common('error')));
      })
      .finally(() => setClearing(false));
  };

  return (
    <div className="mx-auto w-full max-w-page">
      <Container className="pt-6">
        <Breadcrumb
          items={[
            {label: t('crumbs.home'), href: localizeHref(locale, '/')},
            {label: t('crumbs.account'), href: localizeHref(locale, '/account/')},
            {label: t('crumbs.wishlist')},
          ]}
        />
      </Container>

      <Container as="header" className="flex flex-wrap items-end justify-between gap-8 pt-6 pb-10">
        <div className="flex flex-col gap-3">
          <h1 className={PAGE_TITLE}>{t('title')}</h1>
          {ready && (
            <span className="text-[15px] text-text-secondary" aria-live="polite">
              {n ? t('saved', {count: n}) : t('nothingSaved')}
            </span>
          )}
        </div>
        {ready && n > 0 && (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={moving || clearing || items.every(p => p.stock === 'out')}
              aria-busy={moving || undefined}
              onClick={addAll}
              className={cn(
                SOLID_CTA,
                'inline-flex items-center justify-center gap-2 px-6 py-3.5 disabled:cursor-not-allowed disabled:opacity-48'
              )}>
              {moving && <Spinner size={14} />}
              {moving ? t('adding') : addedAll ? t('added') : t('addAll')}
            </button>
            <button
              type="button"
              disabled={clearing || moving}
              aria-busy={clearing || undefined}
              onClick={clearAll}
              className={cn(
                LABEL,
                'inline-flex items-center justify-center gap-2 border border-strong bg-transparent px-6 py-3.5 text-text-primary transition-hover hover:bg-ink-900 hover:text-text-inverse disabled:cursor-not-allowed disabled:opacity-48'
              )}>
              {clearing && <Spinner size={14} />}
              {clearing ? t('clearing') : t('clear')}
            </button>
          </div>
        )}
      </Container>

      {load.state === 'loading' ? (
        <Container className="pb-24">
          <ProductGridSkeleton count={4} columns={4} />
        </Container>
      ) : load.state === 'error' ? (
        <Container className="pb-24">
          <EmptyState
            title={t('loadError')}
            description={load.message}
            action={
              <Button variant="outline" loading={retrying} loadingLabel={common('loading')} onClick={retry}>
                {t('tryAgain')}
              </Button>
            }
          />
        </Container>
      ) : n === 0 ? (
        <Container className="pb-24">
          <EmptyState
            title={t('empty.title')}
            description={t('empty.description')}
            action={
              <a href={localizeHref(locale, '/shop/')} className={cn(SOLID_CTA, 'px-[26px] py-[15px]')}>
                {t('empty.action')}
              </a>
            }
          />
        </Container>
      ) : (
        <Container className="grid grid-cols-2 gap-x-3 gap-y-8 pb-24 sm:gap-x-5 sm:gap-y-10 lg:grid-cols-4">
          {items.map(p => (
            <WishTile key={p.id} product={p} onRemove={() => void remove(p.id)} />
          ))}
        </Container>
      )}

      <Suggestions candidates={candidates} exclude={ids} />
    </div>
  );
}
