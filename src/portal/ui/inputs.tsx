import {type InputHTMLAttributes, type KeyboardEvent, useState} from 'react';

import {Icon} from './icon';

/**
 * Text inputs with a shape of their own, ported from VAREL's product editor
 * (`MoneyInput` in `ProductSections.tsx`, `TagInput` in `ProductEditor.tsx`).
 * Both go inside a `Field` like any input, so the label, hint and error stay
 * the kit's.
 */

/** Keeps digits and one decimal point: what a person may type into an amount. */
export function cleanAmount(raw: string): string {
  const digits = raw.replace(/[^\d.]/g, '');
  const dot = digits.indexOf('.');
  return dot < 0 ? digits : `${digits.slice(0, dot + 1)}${digits.slice(dot + 1).replace(/\./g, '')}`;
}

/**
 * An amount of money: the currency symbol inside the box, digits and one
 * decimal point only, tabular figures. Spread `form.field('price')` into it
 * as into an `<input>` (its `onChange` receives the cleaned value).
 */
export function MoneyInput({
  value,
  onChange,
  symbol = '$',
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (event: {target: {value: string}}) => void;
  /** The currency's symbol, shown before the amount. */
  symbol?: string;
  ref?: (node: HTMLElement | null) => void;
}) {
  return (
    <span className="money-input">
      <span className="money-input-symbol" aria-hidden="true">
        {symbol}
      </span>
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={event => onChange({target: {value: cleanAmount(event.target.value)}})}
      />
    </span>
  );
}

/** New tags from typed text: split on commas, trimmed, lower case, without the ones already there. */
export function parseTags(text: string, existing: string[]): string[] {
  const parts = text
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t && !existing.includes(t));
  return [...new Set(parts)];
}

/**
 * A list of short tags: type and press Enter or a comma to add one, Backspace
 * in the empty box removes the last, × removes any. Leaving the box adds
 * what was typed.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder = 'linen, summer, new',
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [text, setText] = useState('');
  const commit = () => {
    const parts = parseTags(text, value);
    if (parts.length) onChange([...value, ...parts]);
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="tag-input" data-invalid={invalid ? '' : undefined} data-disabled={disabled ? '' : undefined}>
      {value.map(tag => (
        <span key={tag} className="tag-chip">
          {tag}
          <button type="button" aria-label={`Remove tag ${tag}`} disabled={disabled} onClick={() => onChange(value.filter(x => x !== tag))}>
            <Icon name="x" size={14} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={event => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length ? '' : placeholder}
      />
    </div>
  );
}
