/* Cookie consent banner + settings dialog (VAREL docs/PHASE2-3.md §9), ported from VAREL `layout/CookieBanner.tsx`.
   Mounted once per page by the storefront layouts (client:idle). Shown when the store asks for consent (public
   setting `cookieConsent`) and the visitor has not chosen yet. The footer "Cookie settings" button
   (`[data-consent-open]`, Footer.astro) reopens the dialog from any page. */
import {type ReactNode, useEffect, useState} from 'react';

import {Button} from '@/components/varel/Button';
import {Dialog} from '@/components/varel/Dialog';
import {Switch} from '@/components/varel/Switch';
import {type Dicts, TextProvider, useText} from '@/components/varel/text';
import {
  acceptAll,
  CONSENT_OPEN_EVENT,
  type ConsentChoice,
  getConsent,
  necessaryOnly,
  onConsentChange,
  setConsent,
  setConsentRequired,
} from '@/lib/stores/consent';
import {cn} from '@/lib/utils';

const label = 'font-sans text-label-sm font-normal tracking-label uppercase';

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
      <CookieSettingsDialog open={dialogOpen} choice={choice} onClose={() => setDialogOpen(false)} />
    </>
  );
}

function CookieSettingsDialog({open, choice, onClose}: {open: boolean; choice: ConsentChoice | null; onClose: () => void}) {
  const t = useText('privacy');
  const [analytics, setAnalytics] = useState(choice?.analytics ?? false);
  useEffect(() => {
    if (open) setAnalytics(choice?.analytics ?? false);
  }, [open, choice]);

  const save = (next: {analytics: boolean}) => {
    setConsent(next);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('dialog.title')}
      description={t('dialog.description')}
      width={520}
      footer={
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => save({analytics})}>
            {t('dialog.save')}
          </Button>
          <Button size="sm" onClick={() => save({analytics: true})}>
            {t('dialog.acceptAll')}
          </Button>
        </div>
      }>
      <p className="m-0 text-text-secondary">{t('dialog.intro')}</p>
      <ul className="m-0 mt-6 flex list-none flex-col border-t border-hairline p-0">
        <ConsentRow
          title={t('dialog.necessaryTitle')}
          body={t('dialog.necessaryBody')}
          control={<Switch checked disabled label={<span className="sr-only">{t('dialog.necessarySwitch')}</span>} />}
        />
        <ConsentRow
          title={t('dialog.analyticsTitle')}
          body={t('dialog.analyticsBody')}
          control={
            <Switch
              checked={analytics}
              onChange={setAnalytics}
              label={<span className="sr-only">{t('dialog.analyticsSwitch')}</span>}
            />
          }
        />
      </ul>
    </Dialog>
  );
}

function ConsentRow({title, body, control}: {title: string; body: string; control: ReactNode}) {
  return (
    <li className="flex items-start justify-between gap-6 border-b border-hairline py-5 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={cn(label, 'text-text-primary')}>{title}</span>
        <span className="text-body-xs leading-body text-text-secondary">{body}</span>
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </li>
  );
}
