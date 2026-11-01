/* VAREL Search.dc.html — /search/?q=&tab= across products, categories and the journal (port of VAREL
   src/pages/Search.tsx). The page renders the first answer on the server (works without JavaScript: the form is
   a GET form, chips and tabs are links); this island then searches as you type.

   VAREL → here: TanStack Router `navigate` → history.replaceState / pushState (keeping history.state, which the
   Astro ClientRouter owns); `useSearch` (TanStack Query, keepPreviousData) → a hand-rolled fetch with abort, a
   small per-island cache and the previous answer kept (dimmed) while the next one loads; `<Link>` → `<a href>`. */
import {type FormEvent, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useRef, useState} from 'react';

import {Icon} from '@/components/varel/Icon';
import {type Dicts, TextProvider, useText} from '@/components/varel/text';
import {api} from '@/lib/storefront-api';
import type {SearchTab as Tab} from '@/lib/search-params';
import type {SearchResponse} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {chipCls} from './classes';
import {SearchResults} from './SearchResults';
import {MAX_TERM, resultLine, searchEvent, searchUrl, SUGGESTIONS, TABS, termOf, visibleSections} from './search-state';
import {trackSearch} from './track';

export interface SearchAppProps {
  /** The server's answer for `initialQ` (null when there was no term, or the request failed). */
  initial: SearchResponse | null;
  /** The raw `q` from the URL (spaces kept). */
  initialQ: string;
  initialTab: Tab;
  /** The server could not search (`initial` is null although there was a term). */
  failed: boolean;
  locale: string;
  dicts: Dicts;
}

export function SearchApp({locale, dicts, ...props}: SearchAppProps) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Search locale={locale} {...props} />
    </TextProvider>
  );
}

/** Answers kept per island, so retyping a term is instant. */
const CACHE_SIZE = 20;

type Fetched = {term: string; data: SearchResponse | null; failed: boolean};

function Search({initial, initialQ, initialTab, failed: initialFailed, locale}: Omit<SearchAppProps, 'dicts'>) {
  const t = useText('catalog');

  // `q` mirrors the URL (raw text); `text` is the field, which runs ahead of the URL while typing.
  const [q, setQ] = useState(initialQ);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [text, setText] = useState(initialQ);
  const term = termOf(q);

  // The latest settled answer (any term) and whether a newer one is in flight.
  const [fetched, setFetched] = useState<Fetched>({term: termOf(initialQ), data: initial, failed: initialFailed});
  const [pending, setPending] = useState(false);
  const cache = useRef(new Map<string, SearchResponse>());
  if (initial && cache.current.size === 0) cache.current.set(termOf(initialQ), initial);

  const first = useRef(true);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      inflight.current?.abort();
    },
    []
  );

  // Fetch whenever the term changes (an empty term never reaches the API).
  useEffect(() => {
    inflight.current?.abort();
    inflight.current = null;
    if (!term) {
      setPending(false);
      return;
    }
    const hit = cache.current.get(term);
    if (hit) {
      setFetched({term, data: hit, failed: false});
      setPending(false);
      return;
    }
    if (first.current) {
      // The server already answered this term (a failed server answer is retried once here).
      first.current = false;
      if (fetched.term === term && fetched.data) return;
    }
    const controller = new AbortController();
    inflight.current = controller;
    setPending(true);
    api
      .get<SearchResponse>('/search', {q: term}, controller.signal)
      .then(data => {
        if (controller.signal.aborted || data.query !== term) return;
        cache.current.set(term, data);
        if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value as string);
        setFetched({term, data, failed: false});
        setPending(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error as Error)?.name === 'AbortError') return;
        setFetched({term, data: null, failed: true});
        setPending(false);
      });
    // `fetched` is read only on the first run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  // Back / forward between search entries: the page follows the URL again (VAREL's router did this).
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const nextQ = (params.get('q') ?? '').slice(0, MAX_TERM);
      const rawTab = params.get('tab');
      window.clearTimeout(timer.current);
      setQ(nextQ);
      setText(nextQ);
      setTabState(TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'all');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Moves the URL (and the search) to `value`. Typing replaces the history entry; submit and chips push one. */
  const writeQuery = useCallback(
    (value: string, opts: {replace?: boolean; resetTab?: boolean} = {}) => {
      window.clearTimeout(timer.current);
      const nextTab: Tab = opts.resetTab ? 'all' : tab;
      const url = searchUrl(value, nextTab, locale);
      try {
        if (opts.replace) history.replaceState(history.state, '', url);
        else history.pushState(history.state, '', url);
      } catch {
        // a sandboxed frame may refuse history writes: the search still runs
      }
      setQ(value);
      if (opts.resetTab) setTabState('all');
    },
    [tab, locale]
  );

  const onType = (value: string) => {
    setText(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => writeQuery(value, {replace: true}), 300);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    writeQuery(text);
  };

  const onSuggestion = (e: MouseEvent, value: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setText(value);
    writeQuery(value, {resetTab: true});
  };

  /** Tabs filter on the client: no request, no history entry. */
  const selectTab = (next: Tab) => {
    setTabState(next);
    try {
      history.replaceState(history.state, '', searchUrl(q, next, locale));
    } catch {
      // ignore
    }
  };

  const onTab = (e: MouseEvent, next: Tab) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    selectTab(next);
  };

  // The tab chips are links (they work before hydration) acting as toggle buttons: Space presses them too.
  const onTabKey = (e: KeyboardEvent, next: Tab) => {
    if (e.key !== ' ') return;
    e.preventDefault();
    selectTab(next);
  };

  // What is on screen: the answer for this term, or the previous one (dimmed) while this one loads.
  const current = term && fetched.term === term ? fetched : null;
  const data = term ? (current?.data ?? (pending ? fetched.data : null)) : null;
  const stale = !!data && (!current || pending);
  const loading = !!term && pending && !data;
  const failed = !!term && !pending && !!current?.failed;
  const sections = visibleSections(data, tab);
  const {total} = sections;

  // One `search` event per settled term, after a pause (as-you-type prefixes are not counted).
  const settled = !!term && !!current?.data && !pending;
  useEffect(() => {
    if (!settled) return;
    const id = window.setTimeout(() => trackSearch(searchEvent(term, total)), 1200);
    return () => window.clearTimeout(id);
  }, [settled, term, total]);

  const line = resultLine({term, loading: loading || stale, failed, hasData: !!data, total});

  return (
    <div className="mx-auto max-w-page">
      <section className="flex flex-col gap-7 border-b border-hairline px-6 pt-12 pb-8 md:px-12 md:pt-14">
        <h1 className="m-0 font-display text-[40px] leading-[1.06] font-normal tracking-display md:text-[52px]">
          {t('search.title')}
        </h1>
        <form
          onSubmit={onSubmit}
          role="search"
          method="get"
          action={searchUrl('', 'all', locale)}
          noValidate
          className="flex max-w-[720px] items-center gap-4 border-b border-strong"
        >
          <input
            type="search"
            name="q"
            value={text}
            maxLength={200}
            onChange={e => onType(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.title')}
            autoFocus={!initialQ}
            className="min-w-0 flex-1 border-0 bg-transparent py-3 font-sans text-[18px] font-light text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none md:text-[22px]"
          />
          {tab !== 'all' && <input type="hidden" name="tab" value={tab} />}
          <button
            type="submit"
            aria-label={t('search.title')}
            className="flex border-0 bg-transparent p-2 text-text-primary transition-hover hover:text-ink-500"
          >
            <Icon name="search" size={20} />
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-label-sm tracking-label text-text-muted uppercase">{t('search.suggested')}</span>
          {SUGGESTIONS.map(l => (
            <a key={l} href={searchUrl(l, 'all', locale)} onClick={e => onSuggestion(e, l)} className={chipCls()}>
              {t(`search.suggestions.${l}`)}
            </a>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-10 px-6 pt-8 pb-24 md:px-12">
        <div className="flex flex-wrap items-baseline justify-between gap-6">
          <p aria-live="polite" className="m-0 text-[15px] text-text-secondary">
            {'vars' in line ? t(line.key, line.vars) : t(line.key)}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('search.resultType')}>
            {TABS.map(k => (
              <a
                key={k}
                href={searchUrl(q, k, locale)}
                role="button"
                aria-pressed={tab === k}
                onClick={e => onTab(e, k)}
                onKeyDown={e => onTabKey(e, k)}
                className={cn(chipCls(tab === k), 'no-underline')}
              >
                {t(`search.tabs.${k}`)}
              </a>
            ))}
          </div>
        </div>

        <SearchResults data={data} term={term} tab={tab} loading={loading} stale={stale} locale={locale} />
      </section>
    </div>
  );
}
