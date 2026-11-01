/* Cookie consent banner + settings dialog (VAREL docs/PHASE2-3.md §9), ported from VAREL `layout/CookieBanner.tsx`.
   Mounted once per page by the storefront layouts (client:idle). Shown when the store asks for consent (public
   setting `cookieConsent`) and the visitor has not chosen yet. The footer "Cookie settings" button
   (`[data-consent-open]`, Footer.astro) reopens the dialog from any page. */
import {lazy, Suspense, useEffect, useState} from 'react';

import {Button} from '@/components/varel/Button';
import {type Dicts, TextProvider, useText} from '@/components/varel/text';
import {
  acceptAll,
  CONSENT_OPEN_EVENT,
  type ConsentChoice,
  getConsent,
  necessaryOnly,
  onConsentChange,
  setConsentRequired,
} from '@/lib/stores/consent';
import {cn} from '@/lib/utils';

const label = 'font-sans text-label-sm font-normal tracking-label uppercase';

/* The settings dialog loads the first time it opens (I1: most visitors never open it). */
const CookieSettingsDialog = lazy(() => import('./CookieSettingsDialog').then(m => ({default: m.CookieSettingsDialog})));

export interface CookieBannerProps {
  /** Public setting `cookieConsent`; undefined while unknown (the settings could not be read): no banner. */
  required: boolean | undefined;
  privacyHref: string;
  locale: string;
  dicts: Dicts;
}

export function CookieBanner({locale, dicts, ...props}: CookieBannerProps) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Banner {...props} />
    </TextProvider>
  );
}

function Banner({required, privacyHref}: Omit<CookieBannerProps, 'locale' | 'dicts'>) {
  const t = useText('privacy');
  // null on the server and in the first client render (no storage there): the banner appears after hydration.
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogUsed, setDialogUsed] = useState(false);
  useEffect(() => {
    if (dialogOpen) setDialogUsed(true);
  }, [dialogOpen]);

  useEffect(() => {
    setChoice(getConsent());
    setReady(true);
    return onConsentChange(setChoice);
  }, []);
  useEffect(() => {
    if (required !== undefined) setConsentRequired(required);
  }, [required]);
  useEffect(() => {
    const open = () => setDialogOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  const showBanner = ready && required === true && choice === null && !dialogOpen;

  return (
    <>
      {showBanner && (
        <section
          role="region"
          aria-label={t('banner.label')}
          data-cookie-banner
          className={cn(
            'fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface-page px-6 pt-5 pb-6',
            'md:right-auto md:bottom-6 md:left-6 md:w-[420px] md:max-w-[calc(100vw-48px)] md:border md:p-7'
          )}>
          <h2 className={cn(label, 'm-0 text-text-primary')}>{t('banner.title')}</h2>
          <p className="m-0 mt-3 text-body-sm leading-body font-light text-text-secondary">
            {t('banner.body')}{' '}
            <a href={privacyHref} className="text-text-primary">
              {t('banner.privacyLink')}
            </a>
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Button size="sm" onClick={acceptAll}>
              {t('banner.acceptAll')}
            </Button>
            <Button size="sm" variant="outline" onClick={necessaryOnly}>
              {t('banner.necessaryOnly')}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className={cn(
              label,
              'mt-4 border-0 border-b border-strong bg-transparent p-0 pb-0.5 text-text-primary transition-hover hover:text-ink-500'
            )}>
            {t('banner.settings')}
          </button>
        </section>
      )}
      {dialogUsed && (
        <Suspense fallback={null}>
          <CookieSettingsDialog open={dialogOpen} choice={choice} onClose={() => setDialogOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
