/* The cookie settings dialog (VAREL layout/CookieBanner.tsx), split out of CookieBanner.tsx so the dialog code
   (Radix Dialog + Switch) loads only when a visitor opens it, not with every public page (I1). */
import {type ReactNode, useEffect, useState} from 'react';

import {Button} from '@/components/varel/Button';
import {Dialog} from '@/components/varel/Dialog';
import {Switch} from '@/components/varel/Switch';
import {useText} from '@/components/varel/text';
import {type ConsentChoice, setConsent} from '@/lib/stores/consent';
import {cn} from '@/lib/utils';

const label = 'font-sans text-label-sm font-normal tracking-label uppercase';

export function CookieSettingsDialog({open, choice, onClose}: {open: boolean; choice: ConsentChoice | null; onClose: () => void}) {
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
