import {type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState} from 'react';
import {navigate} from 'astro:transitions/client';

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
    <LanguageMenu
      languages={languages}
      current={current}
      footer={footer}
      pending={pending}
      label={t('current', {name: nameOf(current)})}
      heading={t('choose')}
      className={className}
      onPick={pick}>
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
    </LanguageMenu>
  );
}

/**
 * The header / footer language menu: a menu button with radio items (WAI-ARIA menu pattern), the look of the
 * kit's DropdownMenu without Radix (I1: the menu, its popper and floating-ui were ~20 KB gzipped on EVERY public
 * page, since the header island loads first). Opens below (header, right-aligned) or above (footer); Arrow keys,
 * Home/End move between languages, Escape or a click outside closes and returns focus to the button.
 */
function LanguageMenu({
  languages,
  current,
  footer,
  pending,
  label,
  heading,
  className,
  onPick,
  children,
}: {
  languages: LanguageChoice[];
  current: string;
  footer: boolean;
  pending: boolean;
  label: string;
  heading: string;
  className?: string;
  onPick: (lang: LanguageChoice) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Focus the current language when the menu opens; close on a click or focus outside.
  useEffect(() => {
    if (!open) return;
    const all = items();
    (all.find(el => el.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
    const outside = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={wrapper} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={pending}
        aria-busy={pending || undefined}
        data-state={open ? 'open' : 'closed'}
        onClick={() => setOpen(o => !o)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'inline-flex items-center gap-1.5 border-0 bg-transparent p-0 font-sans text-label-md tracking-label uppercase transition-hover active:opacity-48 data-[state=open]:underline data-[state=open]:underline-offset-5',
          footer ? 'text-label-sm text-ink-400 hover:text-text-inverse' : 'text-text-primary hover:underline hover:underline-offset-5',
          className
        )}>
        {children}
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={heading}
          onKeyDown={onMenuKey}
          className={cn(
            'absolute z-50 w-auto min-w-44 overflow-hidden rounded-none border border-hairline bg-popover p-1 text-popover-foreground shadow-overlay',
            footer ? 'bottom-full left-0 mb-2.5' : 'top-full right-0 mt-2.5'
          )}>
          <div className="px-2 py-2 text-label-sm tracking-label text-text-muted uppercase" aria-hidden="true">
            {heading}
          </div>
          {languages.map(lang => {
            const on = lang.code === current;
            return (
              <div
                key={lang.code}
                role="menuitemradio"
                aria-checked={on}
                tabIndex={-1}
                lang={lang.code}
                onClick={() => {
                  close(true);
                  onPick(lang);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    close(true);
                    onPick(lang);
                  }
                }}
                className="relative flex cursor-pointer items-center gap-2.5 rounded-none py-2 pr-8 pl-2 text-body-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
                <LanguageFlag locale={lang.code} />
                {lang.name}
                {on && (
                  <span className="pointer-events-none absolute right-2 flex items-center justify-center">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
