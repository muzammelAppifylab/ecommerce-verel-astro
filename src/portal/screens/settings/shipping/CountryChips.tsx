import {type KeyboardEvent, useId, useState} from 'react';

// Pure constants (no server imports): the same list the routes validate against.
import {COUNTRIES} from '../../../../server/lib/countries';
import {IconButton} from '../../../ui';

/** Country chips with remove buttons and an add field (suggestions from the countries we ship to). Port of VAREL `CountryChips.tsx`. */
export function CountryChips({
  value,
  onChange,
  editable,
  disabled,
  emptyText = 'No countries',
  inputId,
  describedBy,
  invalid,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  editable: boolean;
  disabled?: boolean;
  emptyText?: string;
  /** The add field's id (a `Field` label points at it). */
  inputId?: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const listId = useId();
  const [draft, setDraft] = useState('');

  function add() {
    const name = draft.trim();
    if (!name) return;
    // Match the canonical spelling from the countries list when there is one.
    const canonical = COUNTRIES.find(c => c.toLowerCase() === name.toLowerCase()) ?? name;
    if (!value.some(c => c.toLowerCase() === canonical.toLowerCase())) onChange([...value, canonical]);
    setDraft('');
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  const available = COUNTRIES.filter(c => !value.includes(c));

  return (
    <div className="settings-stack">
      <ul className="settings-chips">
        {value.length === 0 && <li className="muted">{emptyText}</li>}
        {value.map(c => (
          <li key={c} className="settings-chip">
            {c}
            {editable && (
              <button type="button" className="settings-chip-remove" disabled={disabled} aria-label={`Remove ${c}`} onClick={() => onChange(value.filter(x => x !== c))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <span className="settings-inline settings-chips-add">
          <input
            id={inputId}
            className="settings-input"
            list={listId}
            value={draft}
            disabled={disabled}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="Add a country"
            aria-label={inputId ? undefined : 'Add a country'}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
          <datalist id={listId}>
            {available.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <IconButton icon="plus" variant="secondary" label="Add country" disabled={disabled || !draft.trim()} onClick={add} />
        </span>
      )}
    </div>
  );
}
