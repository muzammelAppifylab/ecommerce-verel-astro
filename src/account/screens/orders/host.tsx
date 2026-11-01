/* What the order screens take from the account app that hosts them (WP-13: src/account/**): the words, the page
   language and the tab title. The host modules are looked up by file, so this package builds and runs before
   WP-13 merges (and after, without either package editing the other):

     src/account/i18n.tsx      useAccountT(ns) → t, useAccountContext() → {locale}   (WP-13 §7)
     src/account/useTitle.ts   useTitle(title)

   When a host module is missing, `OrdersTextProvider` (a dictionary built on the server with
   `dictionary(locale, ['orders', 'checkout', 'account'])`) and `document.title` are used instead. */
import {createContext, type ReactNode, useContext, useEffect} from 'react';

import {currentLocale, type Dictionary, type TFunction} from '@/lib/i18n';
import {useT} from '@/lib/i18n/react';

type HostModule = Record<string, unknown>;
const hostModules = import.meta.glob<HostModule>(['../../i18n.tsx', '../../useTitle.ts', '../../AccountApp.tsx'], {
  eager: true,
});

function hostExport<T>(name: string): T | undefined {
  for (const mod of Object.values(hostModules)) {
    if (mod && typeof mod[name] === 'function') return mod[name] as T;
  }
  return undefined;
}

// Chosen once at module load, so every render calls the same hooks (rules of hooks hold).
const hostUseT = hostExport<(ns: string) => TFunction | {t: TFunction}>('useAccountT');
const hostUseContext = hostExport<() => {locale?: string} | null | undefined>('useAccountContext');
const hostUseTitle = hostExport<(title: string) => void>('useTitle');

const EMPTY: Dictionary = {locale: 'en', catalogs: {}};
const OrdersDictContext = createContext<{dict: Dictionary; locale: string} | null>(null);

/** Words and language for the order screens when no account app provides them (tests, previews). */
export function OrdersTextProvider({dict, locale, children}: {dict: Dictionary; locale?: string; children: ReactNode}) {
  return (
    <OrdersDictContext.Provider value={{dict, locale: locale ?? dict.locale}}>{children}</OrdersDictContext.Provider>
  );
}

function useLocalT(ns: string): TFunction {
  const ctx = useContext(OrdersDictContext);
  return useT(ctx?.dict ?? EMPTY, ns);
}

/** `t` for a namespace (`orders`, `returns`, `checkout`…); keys may name another one (`checkout:qty`). */
export function useOrdersT(ns = 'orders'): TFunction {
  if (hostUseT) {
    const r = hostUseT(ns);
    return typeof r === 'function' ? r : r.t;
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the branch is fixed per build (see above)
  return useLocalT(ns);
}

/** The page language ("en", "da"…). */
export function useOrdersLocale(): string {
  const local = useContext(OrdersDictContext);
  const host = hostUseContext ? hostUseContext() : null;
  return host?.locale ?? local?.locale ?? currentLocale();
}

/** Sets the tab title ("Orders · VAREL" through the host's hook; the bare title otherwise). */
export function useOrdersTitle(title: string): void {
  if (hostUseTitle) {
    hostUseTitle(title);
    return;
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the branch is fixed per build (see above)
  useEffect(() => {
    if (!title) return;
    const site = document.title.includes(' · ') ? document.title.slice(document.title.lastIndexOf(' · ')) : '';
    document.title = `${title}${site}`;
  }, [title]);
}
