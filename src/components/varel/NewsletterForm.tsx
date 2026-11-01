import {useId, useState} from 'react';

import {siteFetch} from '@/platform/browser';
import {cn} from '@/lib/utils';

import {Icon} from './Icon';
import {useText} from './text';

export interface NewsletterFormProps {
  /** Sent to the API as `source` (e.g. "home", "journal", "footer") */
  source?: string;
  /** Note under the field before subscribing (default: journal:newsletterForm.note) */
  note?: string;
  /** Note after subscribing */
  successNote?: string;
  /** `inverse` sits on the obsidian footer */
  tone?: 'default' | 'inverse';
  className?: string;
}

type Status = 'idle' | 'pending' | 'done';

/** Underlined email + "Subscribe" (Home / Journal / footer newsletter blocks). Posts to /site-api/newsletter
 *  (`{email, source}` → 204, idempotent; WP-20 implements the route). */
export function NewsletterForm({source, note, successNote, tone = 'default', className}: NewsletterFormProps) {
  const t = useText('journal');
  const common = useText('common');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const done = status === 'done';
  const pending = status === 'pending';
  const inverse = tone === 'inverse';
  const noteId = useId();

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || done) return;
    setError(null);
    // Pasted and autofilled addresses often carry spaces: check and send the trimmed address.
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) return setError(t('newsletterForm.invalidEmail'));
    setStatus('pending');
    try {
      const res = await siteFetch('/site-api/newsletter', {
        method: 'POST',
        headers: {'content-type': 'application/json', accept: 'application/json'},
        body: JSON.stringify({email: value, ...(source ? {source} : {})}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {message?: string; fields?: Record<string, string>} | null;
        // The server checks the address more strictly: show its message for the field, not the form-level one.
        setError(body?.fields?.email ?? body?.message ?? common('error'));
        setStatus('idle');
        return;
      }
      setStatus('done');
    } catch {
      setError(common('error'));
      setStatus('idle');
    }
  };

  return (
    <form noValidate className={cn('flex flex-col gap-3', className)} onSubmit={e => void submit(e)}>
      <div
        className={cn(
          'flex border-b transition-hover',
          inverse ? 'border-ink-000/40 focus-within:border-ink-000' : 'border-strong'
        )}>
        <input
          type="email"
          value={email}
          onChange={e => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          placeholder={t('newsletterForm.emailLabel')}
          aria-label={t('newsletterForm.emailLabel')}
          aria-invalid={error ? true : undefined}
          aria-describedby={noteId}
          autoComplete="email"
          disabled={done}
          className={cn(
            'h-[52px] min-w-0 flex-1 rounded-none border-0 bg-transparent text-body-md font-light outline-none focus-visible:outline-none',
            inverse ? 'text-text-inverse placeholder:text-ink-400' : 'text-text-primary placeholder:text-ink-500'
          )}
        />
        <button
          type="submit"
          disabled={pending || done}
          aria-busy={pending || undefined}
          className={cn(
            'inline-flex items-center gap-2 border-0 bg-transparent pr-1 pl-4 text-label-sm tracking-label uppercase transition-hover disabled:cursor-default',
            inverse ? 'text-text-inverse hover:text-ink-300' : 'hover:text-ink-500'
          )}>
          {pending ? t('newsletterForm.sending') : done ? t('newsletterForm.subscribed') : t('newsletterForm.subscribe')}
          {done ? <Icon name="check" size={14} /> : <Icon name="arrow-right" size={14} />}
        </button>
      </div>
      <span
        id={noteId}
        role={error ? 'alert' : 'status'}
        className={cn(
          'text-body-xs',
          error ? (inverse ? 'text-text-inverse' : 'text-signal-critical') : inverse ? 'text-ink-400' : 'text-text-muted'
        )}>
        {error ?? (done ? (successNote ?? t('newsletterForm.success')) : (note ?? t('newsletterForm.note')))}
      </span>
    </form>
  );
}
