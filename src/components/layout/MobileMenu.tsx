import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {useText} from '@/components/varel/text';
import {useBag} from '@/lib/stores/bag';
import {ui, useUI} from '@/lib/stores/ui';

import type {Chrome} from './chrome';
import {LanguageSwitcher} from './LanguageSwitcher';
import {MenuLink} from './MenuLink';

export type MobileMenuProps = Pick<Chrome, 'header' | 'links' | 'signedIn' | 'languages' | 'locale'>;

/** Mobile navigation drawer (right edge, below lg), ported from VAREL `layout/MobileMenu.tsx`. */
export function MobileMenu({header, links, signedIn, languages, locale}: MobileMenuProps) {
  const {menuOpen} = useUI();
  const {count, wishlist} = useBag();
  const t = useText('layout');
  const common = useText('common');
  const secondary = 'border-0 text-label-md tracking-label text-text-primary uppercase';
  return (
    <Sheet open={menuOpen} onOpenChange={o => !o && ui.closeMenu()}>
      <SheetContent side="right" closeLabel={common('close')} className="w-full max-w-[400px]! gap-0">
        <SheetHeader className="pr-16">
          <SheetTitle>{t('mobileMenu.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('mobileMenu.description')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-8 pb-8 max-sm:px-6">
          <nav aria-label={t('header.departments')} className="flex flex-col gap-4 pt-2">
            {header.items.map((n, i) => (
              <MenuLink
                key={`${i}-${n.url}`}
                item={n}
                onClick={ui.closeMenu}
                className="border-0 font-display text-display-4 text-text-primary"
              />
            ))}
            <a href={links.shop} onClick={ui.closeMenu} className="border-0 font-display text-display-4 text-text-primary">
              {t('mobileMenu.allProducts')}
            </a>
          </nav>
          <nav aria-label={t('header.accountAndBag')} className="mt-10 flex flex-col gap-5 border-t border-hairline pt-8">
            <a href={links.search} onClick={ui.closeMenu} className={secondary}>
              {t('header.search')}
            </a>
            <a href={signedIn ? links.account : links.signIn} onClick={ui.closeMenu} className={secondary}>
              {signedIn ? t('header.account') : t('mobileMenu.signIn')}
            </a>
            <a href={links.wishlist} onClick={ui.closeMenu} className={secondary}>
              {t('header.wishlist', {count: wishlist.length})}
            </a>
            <button type="button" onClick={ui.openBag} className={`${secondary} self-start bg-transparent p-0 text-left`}>
              {t('header.bag', {count})}
            </button>
          </nav>
          <LanguageSwitcher
            variant="list"
            languages={languages}
            current={locale}
            signedIn={signedIn}
            onChosen={ui.closeMenu}
            className="mt-10 border-t border-hairline pt-8"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
