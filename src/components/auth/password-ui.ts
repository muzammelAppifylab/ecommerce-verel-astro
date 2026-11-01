/* Password helpers for the sign-in pages, in the page's language (WP-15).

   - `passwordScore` / `bindStrengthMeter`: VAREL `src/pages/auth/PasswordStrength.tsx` (2px meter, label,
     hint). The width comes from a `data-level` class in auth.css (no inline style: CSP).
   - `bindLocalizedPasswordChecks`, `bindLocalizedReveal`, `localizedPasswordRule`: the template's
     `bindPasswordChecks`, `bindPasswordReveal` and `passwordMeetsRules` (src/lib/password-checks.ts,
     src/lib/rules.ts) with the same DOM contract (`data-tried`, `data-ok`, `aria-pressed`), but localized.
   Rules: the template's `passwordChecks` (length 10–128, not the email name); the server also refuses
   the most common passwords. */
import type { TFunction } from '../../lib/i18n/core'
import { matchCheck, type PasswordCheck, passwordChecks } from '../../lib/password-checks'
import type { Rule } from '../../lib/rules'
import { PASSWORD_LIMITS } from '../../platform/auth/password'

export const STRENGTH_LEVELS = ['weak', 'fair', 'good', 'strong'] as const

/** VAREL's score: long enough, a digit, a symbol (0–3). "Long enough" is the template's minimum (10). */
export function passwordScore(pw: string): number {
  return (pw.length >= PASSWORD_LIMITS.min ? 1 : 0) + (/\d/.test(pw) ? 1 : 0) + (/[^a-z0-9]/i.test(pw) ? 1 : 0)
}

/** 0 = empty, 1 weak … 4 strong (the meter's `data-level`). */
export function strengthLevel(pw: string): number {
  return pw ? Math.min(passwordScore(pw), 3) + 1 : 0
}

/** The checklist items with the page's words. */
export function localizedChecks(password: string, email: string, t: TFunction): PasswordCheck[] {
  return passwordChecks(password, email).map((check) => ({
    ...check,
    label:
      check.id === 'length'
        ? t('checks.length', { min: PASSWORD_LIMITS.min })
        : check.id === 'max'
          ? t('checks.max', { max: PASSWORD_LIMITS.max })
          : check.id === 'email'
            ? t('checks.email')
            : check.label,
  }))
}

function render(list: HTMLElement, checks: PasswordCheck[], t: TFunction) {
  list.replaceChildren(
    ...checks.map((check) => {
      const item = document.createElement('li')
      if (check.ok) item.dataset.ok = ''
      const state = document.createElement('span')
      state.className = 'pw-checks-state'
      state.textContent = ` ${check.ok ? t('checks.done') : t('checks.notYet')}`
      item.append(check.label, state)
      return item
    }),
  )
}

interface ChecksOptions {
  email?: HTMLInputElement | null
  confirm?: HTMLInputElement | null
  confirmList?: HTMLElement | null
}

/** BROWSER: keeps a `<ul class="pw-checks">` live; after a submit, missing rules turn red (`data-tried`). */
export function bindLocalizedPasswordChecks(input: HTMLInputElement, list: HTMLElement, t: TFunction, options: ChecksOptions = {}): void {
  const { email, confirm, confirmList } = options
  const update = () => {
    render(list, localizedChecks(input.value, email?.value ?? '', t), t)
    if (confirm && confirmList) {
      const show = !!confirm.value || confirmList.hasAttribute('data-tried')
      confirmList.hidden = !show
      if (show) render(confirmList, [{ ...matchCheck(input.value, confirm.value), label: t('checks.match') }], t)
    }
  }
  for (const field of [input, email, confirm]) field?.addEventListener('input', update)
  input.form?.addEventListener('submit', () => {
    list.setAttribute('data-tried', '')
    confirmList?.setAttribute('data-tried', '')
    update()
  })
  update()
}

/** A NEW password must pass every checklist rule (the list says which one is missing). */
export function localizedPasswordRule(t: TFunction, email: () => string = () => ''): Rule {
  return (value) =>
    !value ? t('choosePassword') : passwordChecks(value, email()).every((check) => check.ok) ? null : t('checks.unmet')
}

/** BROWSER: the show / hide button of every `[data-reveal-password]` in `root`. */
export function bindLocalizedReveal(root: ParentNode, t: TFunction): void {
  root.querySelectorAll<HTMLButtonElement>('[data-reveal-password]').forEach((button) => {
    const input = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLInputElement | null
    if (!input || button.dataset.bound) return
    button.dataset.bound = ''
    button.hidden = false
    const paint = () => {
      const shown = input.type === 'text'
      button.setAttribute('aria-pressed', String(shown))
      button.textContent = shown ? t('reveal.hide') : t('reveal.show')
      button.setAttribute('aria-label', shown ? t('reveal.hideLabel') : t('reveal.showLabel'))
    }
    button.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password'
      paint()
    })
    paint()
  })
}

/** BROWSER: VAREL's strength meter under a new-password field (`.auth-strength[data-level]`). */
export function bindStrengthMeter(input: HTMLInputElement, meter: HTMLElement, t: TFunction): void {
  const label = meter.querySelector<HTMLElement>('[data-strength-label]')
  const update = () => {
    const level = strengthLevel(input.value)
    meter.dataset.level = String(level)
    if (label) label.textContent = level ? t(`strength.${STRENGTH_LEVELS[level - 1]}`) : t('strength.empty')
  }
  input.addEventListener('input', update)
  update()
}
