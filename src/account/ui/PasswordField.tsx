import { useState } from 'react'
import { Icon } from '@/components/varel'
import { useAccountT } from '../i18n'
import { ProfileField, type ProfileFieldProps } from './ProfileField'

/** A password field with its own show / hide button, hidden by default (AGENTS.md: never a bare password input). */
export function PasswordField(props: Omit<ProfileFieldProps, 'type' | 'trailing'>) {
  const t = useAccountT('account')
  const [show, setShow] = useState(false)
  return (
    <ProfileField
      {...props}
      type={show ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          aria-label={show ? t('password.hideOne') : t('password.showOne')}
          className="flex size-9 items-center justify-center border-0 bg-transparent text-text-secondary transition-hover hover:text-text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-ink-900"
        >
          <Icon name={show ? 'eye-off' : 'eye'} size={16} />
        </button>
      }
    />
  )
}
