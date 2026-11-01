import {useEffect, useState} from 'react';

import {IconButton} from '@/components/varel/IconButton';
import {isActivePath} from '@/components/varel/href';
import {TextProvider, useText} from '@/components/varel/text';
import {Wordmark} from '@/components/varel/Wordmark';
import {bag, useBag} from '@/lib/stores/bag';
import {ui} from '@/lib/stores/ui';
import {cn} from '@/lib/utils';

import {BagDrawer} from './BagDrawer';
import type {Chrome} from './chrome';
import {LanguageSwitcher} from './LanguageSwitcher';
import {MenuLink} from './MenuLink';
import {MobileMenu} from './MobileMenu';

export type SiteHeaderProps = Pick<Chrome, 'header' | 'links' | 'signedIn' | 'languages' | 'locale' | 'path' | 'dicts'>;

const navLink = 'border-0 text-text-primary transition-hover';

/**
 * The storefront header island (client:load): the sticky header, the mobile menu and the bag drawer frame.
 * Ported from VAREL `layout/Header.tsx` (+ MobileMenu, BagDrawer mounted in SiteLayout).
 * Sticky 72px header: departments left, wordmark centre, Language / Search / Account / Wishlist (n) / Bag (n) right.
 * Gains the lift shadow once the page scrolls. Bag opens the drawer. Below lg: menu + wordmark + search/bag icons.
 */
export function SiteHeader(props: SiteHeaderProps) {
  return (
    <TextProvider locale={props.locale} dicts={props.dicts}>
      <HeaderBar {...props} />
      <MobileMenu {...props} />
      <BagDrawer links={props.links} />
    </TextProvider>
  );
}

function HeaderBar({header, links, signedIn, languages, locale, path}: SiteHeaderProps) {
  const t = useText('layout');
  const {count, wishlist} = useBag();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // A new page (first load or a client navigation): every layer starts closed, the counts come from the server.
    ui.closeAll();
    void bag.sync();
    const on = () => setScrolled(window.scrollY > 36);
    on();
    window.addEventListener('scroll', on, {passive: true});
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header
      className={cn(
        'site-header sticky top-0 z-40 border-b border-hairline bg-ink-000/90 backdrop-blur-glass transition-shadow duration-240 ease-standard',
        scrolled && 'shadow-lift'
      )}>
      <div className="mx-auto grid h-16 max-w-page grid-cols-[1fr_auto_1fr] items-center gap-6 px-6 md:px-12 lg:h-[72px]">
        {/* left */}
        <nav aria-label={t('header.departments')} className="hidden gap-7 font-sans text-label-md tracking-label uppercase lg:flex">
          {header.items.map((n, i) => (
            <MenuLink key={`${i}-${n.url}`} item={n} className={navLink} active={!n.external && isActivePath(path, n.href)} />
          ))}
        </nav>
        <div className="-ml-2.5 lg:hidden">
          <IconButton name="menu" label={t('header.openMenu')} size={40} onClick={ui.openMenu} />
        </div>

        {/* centre */}
        <Wordmark size={24} href={links.home} />

        {/* right */}
        <nav
          aria-label={t('header.accountAndBag')}
          className="hidden items-center gap-6 justify-self-end font-sans text-label-md tracking-label uppercase lg:flex">
          <LanguageSwitcher languages={languages} current={locale} signedIn={signedIn} />
          <a href={links.search} className={navLink}>
            {t('header.search')}
          </a>
          <a href={links.account} className={navLink}>
            {t('header.account')}
          </a>
          <a href={links.wishlist} className={navLink}>
            {t('header.wishlist', {count: wishlist.length})}
          </a>
          <button
            type="button"
            onClick={ui.openBag}
            aria-haspopup="dialog"
            className="border-0 bg-transparent p-0 tracking-label uppercase transition-hover hover:underline hover:underline-offset-5">
            {t('header.bag', {count})}
          </button>
        </nav>
        <div className="-mr-2.5 flex items-center justify-self-end lg:hidden">
          <a href={links.search} aria-label={t('header.search')} className="inline-flex size-10 items-center justify-center border-0">
            <span className="sr-only">{t('header.search')}</span>
            <SearchGlyph />
          </a>
          <button
            type="button"
            onClick={ui.openBag}
            aria-haspopup="dialog"
            aria-label={t('header.openBag', {count})}
            className="relative inline-flex h-10 items-center gap-1 border-0 bg-transparent px-2.5 font-sans text-label-md tracking-label whitespace-nowrap uppercase">
            {t('header.bagShort', {count})}
          </button>
        </div>
      </div>
    </header>
  );
}

function SearchGlyph() {
  // Kept local to avoid an extra IconButton nesting inside a link.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
