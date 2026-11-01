import {useState} from 'react';
import {navigate} from 'astro:transitions/client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Icon} from '@/components/varel/Icon';
import {useText} from '@/components/varel/text';
import {cn} from '@/lib/utils';
import {siteFetch} from '@/platform/browser';

import {LanguageFlag} from './LanguageFlag';

export interface LanguageChoice {
  code: string;
  name: string;
  /** This page in that language (`/da/shop/women/`) */
  href: string;
}

/** The language cookie VAREL used (`varel_locale`, a year, SameSite=Lax): src/middleware.ts reads it for `/`. */
export const LOCALE_COOKIE = 'varel_locale';

function writeLocaleCookie(code: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(code)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
}

/** Switch language: remember it (cookie), save it on the account (signed in), open this page in it. */
function useSwitch(current: string, signedIn: boolean) {
  const [pending, setPending] = useState(false);
  const choose = (lang: LanguageChoice) => {
    if (lang.code === current || pending) return;
    setPending(true);
    writeLocaleCookie(lang.code);
    if (signedIn) {
      // PATCH /site-api/account/locale (WP-15): best effort, the URL already carries the choice.
      void siteFetch('/site-api/account/locale', {
        method: 'PATCH',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({locale: lang.code}),
      }).catch(() => null);
    }
    void navigate(lang.href).finally(() => setPending(false));
  };
  return {choose, pending};
}

export interface LanguageSwitcherProps {
  languages: LanguageChoice[];
  /** The page language */
  current: string;
  signedIn?: boolean;
  /** `header`: code trigger in the right cluster · `footer`: "Language · English" on obsidian · `list`: inline list (mobile menu). */
  variant?: 'header' | 'footer' | 'list';
  className?: string;
  /** Called after a language is picked (e.g. to close the mobile menu). */
  onChosen?: () => void;
}

/** Storefront language control: native language names, the current one marked. Hidden when one language is enabled. */
export function LanguageSwitcher({languages, current, signedIn = false, variant = 'header', className, onChosen}: LanguageSwitcherProps) {
  const t = useText('i18n');
  const {choose, pending} = useSwitch(current, signedIn);
  if (languages.length < 2) return null;
  const nameOf = (code: string) => languages.find(l => l.code === code)?.name ?? code.toUpperCase();

  const pick = (lang: LanguageChoice) => {
    choose(lang);
    onChosen?.();
  };

  if (variant === 'list') {
    return (
      <div className={cn('flex flex-col gap-3', className)} role="group" aria-label={t('choose')}>
        <span className="text-label-sm tracking-label text-text-muted uppercase">{t('language')}</span>
        <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-3 p-0" aria-busy={pending || undefined}>
          {languages.map(lang => {
            const on = lang.code === current;
            return (
              <li key={lang.code}>
                <a
                  href={lang.href}
                  lang={lang.code}
                  hrefLang={lang.code}
                  aria-current={on ? 'true' : undefined}
                  onClick={e => {
                    e.preventDefault();
                    pick(lang);
                  }}
                  className={cn(
                    'inline-flex items-center gap-2 border-0 bg-transparent p-0 text-label-md tracking-label uppercase transition-hover active:opacity-48',
                    on ? 'text-text-primary underline underline-offset-5' : 'text-text-secondary hover:text-text-primary'
                  )}>
                  <LanguageFlag locale={lang.code} size={18} />
                  {lang.name}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const footer = variant === 'footer';
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t('current', {name: nameOf(current)})}
        disabled={pending}
        aria-busy={pending || undefined}
        className={cn(
          'inline-flex items-center gap-1.5 border-0 bg-transparent p-0 font-sans text-label-md tracking-label uppercase transition-hover active:opacity-48 data-[state=open]:underline data-[state=open]:underline-offset-5',
          footer ? 'text-label-sm text-ink-400 hover:text-text-inverse' : 'text-text-primary hover:underline hover:underline-offset-5',
          className
        )}>
        {footer ? (
          <>
            {t('language')} · <LanguageFlag locale={current} size={16} /> <span lang={current}>{nameOf(current)}</span>
          </>
        ) : (
          <>
            <LanguageFlag locale={current} size={18} />
            <span lang={current}>{current.toUpperCase()}</span>
          </>
        )}
        <Icon name="chevron-down" size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={footer ? 'start' : 'end'}
        side={footer ? 'top' : 'bottom'}
        sideOffset={10}
        className="w-auto min-w-44 p-1">
        <DropdownMenuLabel className="text-label-sm tracking-label text-text-muted uppercase">{t('choose')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={code => {
            const lang = languages.find(l => l.code === code);
            if (lang) pick(lang);
          }}>
          {languages.map(lang => (
            <DropdownMenuRadioItem key={lang.code} value={lang.code} lang={lang.code} className="gap-2.5 text-body-sm">
              <LanguageFlag locale={lang.code} />
              {lang.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
