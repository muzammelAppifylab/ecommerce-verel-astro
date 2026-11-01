import { useEffect } from 'react'
import { useAccountContext } from './i18n'

/** The tab title of an account screen: "<title> · <store>" (Base.astro's format). */
export function useTitle(title: string | null | undefined): void {
  const { siteName } = useAccountContext()
  useEffect(() => {
    if (title) document.title = `${title} · ${siteName}`
  }, [title, siteName])
}
