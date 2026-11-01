/* Words and context of the account app. The host page passes one dictionary (F4 `dictionary(locale, ns[])`);
   screens read it with `useAccountT('account')` (`t('nav.orders')`, `t('orders:orderNumber', {number})`). */
import { createContext, useContext, type ReactNode } from 'react'
import type { Dictionary, TFunction } from '@/lib/i18n/core'
import { useT } from '@/lib/i18n/react'

export interface AccountContextValue {
  dict: Dictionary
  /** Page language (`en`, `da`, …). */
  locale: string
  /** Router base: `/account` or `/da/account` (no trailing slash). */
  basepath: string
  /** Store name for tab titles. */
  siteName: string
}

const EMPTY: AccountContextValue = { dict: { locale: 'en', catalogs: {} }, locale: 'en', basepath: '/account', siteName: 'VAREL' }

const AccountContext = createContext<AccountContextValue>(EMPTY)

export function AccountProvider({ value, children }: { value: AccountContextValue; children: ReactNode }) {
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

/** `{dict, locale, basepath, siteName}` of the account app. */
export const useAccountContext = () => useContext(AccountContext)

/** `const t = useAccountT('account')`; other namespaces with a prefix: `t('orders:stages.shipped')`. */
export function useAccountT(ns = 'account'): TFunction {
  return useT(useContext(AccountContext).dict, ns)
}
