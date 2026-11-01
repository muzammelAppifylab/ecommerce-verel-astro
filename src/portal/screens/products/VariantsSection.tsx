import {Fragment, type ReactNode, useId, useMemo, useRef, useState} from 'react';

import {pluralize} from '../../../lib/format';
import {Badge, Button, Card, cleanAmount, Icon, IconButton, Menu, type MenuItem, MoneyInput, Popover, Select} from '../../ui';
import {RowCheck} from '../inventory/parts';
import {
  build,
  comboKey,
  effectivePrice,
  effectiveSku,
  guessSwatch,
  KIND_LABEL,
  KNOWN_SWATCHES,
  MAX_OPTIONS,
  missingCombos,
  NEUTRAL,
  newOption,
  type OptionDef,
  type OptKind,
  SIZE_PRESETS,
  valueOf,
  type VariantItem,
  type VariantsState,
  variantSku,
  withValue,
} from './variants';

/*
 * Variants, Shopify-style (port of VAREL `src/pages/admin/products/VariantsSection.tsx`): up to 3
 * options (colour, size, or any custom name) with value chips, variants generated live from the
 * options, a table grouped by one option with inline price / stock / SKU, and bulk edits on
 * selected rows. Variant prices left empty use the product price and follow it.
 *
 * Rendered by the product editor (WP-17) exactly as VAREL did:
 *   <VariantsSection key={variantsKey} options={…} variants={…} onChange={update => …}
 *     baseSku={…} productPrice={…} digital={…} errors={…} disabled={…} currencySymbol="$" />
 * It only edits form state: saving is the editor's `PUT /manage/products/:id`.
 *
 * Swatches are SVG circles (`fill` is an attribute, not an inline style, so the CSP holds).
 * Styles: `./variants-section/screen.css` (bundled with every screen.css).
 */

export type {VariantsState} from './variants';

/** Field errors as the product editor keeps them: `variants`, `variants.<i>.id|price|inventory`. */
export type FieldErrors = Record<string, string | undefined>;

const SIZE_SUGGESTIONS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '34', '36', '38', '40', '42', '44', '46', 'One size'];
const CUSTOM_NAMES = ['Material', 'Fabric', 'Length', 'Fit', 'Style', 'Pattern', 'Finish', 'Width'];

export const title = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const normalValue = (d: Pick<OptionDef, 'kind'>, raw: string) =>
  d.kind === 'size' && raw.trim().length <= 4 ? raw.trim().toUpperCase() : title(raw);
const labelOf = (d: OptionDef) => d.name.trim() || 'New option';

/** Hairline swatch dot (VAREL `Swatch`), drawn in SVG. */
export function Swatch({hex, size = 12}: {hex: string | null | undefined; size?: 12 | 14 | 16}) {
  if (!hex) return null;
  const r = size / 2;
  return (
    <svg className="swatch" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={r} cy={r} r={r - 0.5} fill={hex} stroke="currentColor" strokeOpacity="0.25" />
    </svg>
  );
}

export function VariantsSection({
  options: defs,
  variants,
  onChange,
  baseSku,
  productPrice,
  digital,
  errors,
  disabled,
  currencySymbol = '$',
}: {
  options: OptionDef[];
  variants: VariantItem[];
  onChange: (update: (prev: VariantsState) => VariantsState) => void;
  baseSku: string;
  /** Variants without their own price use this. */
  productPrice: string;
  digital: boolean;
  errors: FieldErrors;
  disabled?: boolean;
  /** The store currency's symbol (VAREL showed `$`). */
  currencySymbol?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  // Combinations missing from the saved rows were removed on purpose; keep them out when options change.
  const [removed, setRemoved] = useState<Set<string>>(() => missingCombos(defs, variants));

  if (digital) return null;

  /** New options, rows rebuilt from them. `before` adjusts the rows first (renames, a new option's first value). */
  const apply = (next: OptionDef[], before?: (v: VariantItem[]) => VariantItem[], nextRemoved: ReadonlySet<string> = removed) =>
    onChange(s => ({options: next, variants: build(next, before ? before(s.variants) : s.variants, nextRemoved)}));

  const patchDef = (id: string, p: Partial<OptionDef>) => defs.map(d => (d.id === id ? {...d, ...p} : d));

  const addOption = (kind: OptKind) => {
    if (defs.length >= MAX_OPTIONS) return;
    const d = newOption(kind);
    onChange(s => ({...s, options: [...s.options, d]}));
    setEditing(d.id);
  };

  const deleteOption = (d: OptionDef) => {
    setEditing(null);
    setRemoved(new Set());
    apply(
      defs.filter(x => x.id !== d.id),
      rows => rows.map(v => ({...withValue(v, d, null), ...(d.kind === 'color' ? {swatch: null} : {})})),
      new Set()
    );
  };

  const moveOption = (d: OptionDef, dir: -1 | 1) => {
    const i = defs.findIndex(x => x.id === d.id);
    const j = i + dir;
    if (j < 0 || j >= defs.length) return;
    const next = [...defs];
    [next[i], next[j]] = [next[j]!, next[i]!];
    apply(next);
  };

  const renameOption = (d: OptionDef, raw: string) => {
    const name = title(raw);
    if (!name || name === d.name || defs.some(x => x.id !== d.id && same(x.name, name))) return false;
    apply(patchDef(d.id, {name}), rows =>
      rows.map(v => {
        const value = valueOf(v, d);
        return value == null ? v : withValue(withValue(v, d, null), {kind: d.kind, name}, value);
      })
    );
    return true;
  };

  const addValues = (d: OptionDef, raw: string[]) => {
    const values = [...d.values];
    for (const r of raw) {
      const name = normalValue(d, r);
      if (name && !values.some(v => same(v.name, name))) values.push(d.kind === 'color' ? {name, hex: guessSwatch(name)} : {name});
    }
    if (values.length === d.values.length) return;
    // An option's first value goes onto the rows that exist, so their stock, price and SKU carry over.
    const first = d.values.length === 0 ? values[0] : null;
    apply(patchDef(d.id, {values}), first ? rows => rows.map(v => withValue(v, d, first.name)) : undefined);
  };

  const removeValue = (d: OptionDef, name: string) => apply(patchDef(d.id, {values: d.values.filter(v => v.name !== name)}));

  const renameValue = (d: OptionDef, from: string, raw: string) => {
    const to = normalValue(d, raw);
    if (!to || to === from || d.values.some(v => v.name !== from && same(v.name, to))) return;
    apply(patchDef(d.id, {values: d.values.map(v => (v.name === from ? {...v, name: to} : v))}), rows =>
      rows.map(v => {
        if (valueOf(v, d) !== from) return v;
        const moved = withValue(v, d, to);
        // A SKU that was generated follows the new name.
        return v.id === variantSku(baseSku, v.color, v.size, Object.values(v.options ?? {})) ? {...moved, id: ''} : moved;
      })
    );
  };

  const recolour = (d: OptionDef, name: string, hex: string) =>
    apply(patchDef(d.id, {values: d.values.map(v => (v.name === name ? {...v, hex} : v))}));

  const moveValue = (d: OptionDef, name: string, dir: -1 | 1) => {
    const list = [...d.values];
    const i = list.findIndex(v => v.name === name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    apply(patchDef(d.id, {values: list}));
  };

  const finish = (d: OptionDef, named: boolean) => {
    setEditing(null);
    if (!d.values.length || !named) deleteOption(d);
  };

  const removeVariants = (uids: ReadonlySet<string>) => {
    const keys = variants.filter(v => uids.has(v.uid)).map(v => comboKey(v, defs));
    setRemoved(new Set([...removed, ...keys]));
    onChange(s => ({...s, variants: s.variants.filter(v => !uids.has(v.uid))}));
  };

  const restore = () => {
    setRemoved(new Set());
    onChange(s => ({...s, variants: build(s.options, s.variants, new Set())}));
  };

  const has = (k: OptKind) => defs.some(d => d.kind === k);
  const hasValues = defs.some(d => d.values.length > 0);
  const canAdd = !disabled && editing === null && defs.length < MAX_OPTIONS;

  const addItems: MenuItem[] = [];
  if (!has('color')) addItems.push({label: 'Colour — with swatches', onSelect: () => addOption('color')});
  if (!has('size')) addItems.push({label: 'Size — size guide', onSelect: () => addOption('size')});
  if (addItems.length) addItems.push('separator');
  addItems.push({label: 'Custom option… — Fabric, Length…', onSelect: () => addOption('custom')});

  return (
    <div className="variants-section">
      <Card title="Variants" description={defs.length ? `${defs.length} of ${MAX_OPTIONS} options` : undefined} flush>
        {defs.length > 0 && (
          <ul className="vs-options">
            {defs.map((d, i) =>
              editing === d.id ? (
                <OptionEditor
                  key={d.id}
                  def={d}
                  others={defs.filter(x => x.id !== d.id)}
                  disabled={disabled}
                  onRename={name => renameOption(d, name)}
                  onAdd={vals => addValues(d, vals)}
                  onRemove={n => removeValue(d, n)}
                  onRenameValue={(from, to) => renameValue(d, from, to)}
                  onRecolour={(n, hex) => recolour(d, n, hex)}
                  onMove={(n, dir) => moveValue(d, n, dir)}
                  onDelete={() => deleteOption(d)}
                  onDone={named => finish(d, named)}
                />
              ) : (
                <OptionSummary
                  key={d.id}
                  def={d}
                  disabled={disabled || editing !== null}
                  first={i === 0}
                  last={i === defs.length - 1}
                  onEdit={() => setEditing(d.id)}
                  onMove={dir => moveOption(d, dir)}
                />
              )
            )}
          </ul>
        )}

        {(canAdd || (defs.length >= MAX_OPTIONS && editing === null)) && (
          <div className="vs-add" data-boxed={defs.length ? undefined : ''}>
            {canAdd ? (
              <Menu
                label={defs.length ? 'Add another option' : 'Add options like colour, size or fabric'}
                align="start"
                items={addItems}
                trigger={
                  <span className="vs-add-trigger">
                    <Icon name="plus" size={14} />
                    {defs.length ? 'Add another option' : 'Add options like colour, size or fabric'}
                  </span>
                }
              />
            ) : (
              <span className="muted">Products can have up to {MAX_OPTIONS} options.</span>
            )}
          </div>
        )}

        {hasValues ? (
          <VariantTable
            defs={defs.filter(d => d.values.length > 0)}
            variants={variants}
            baseSku={baseSku}
            productPrice={productPrice}
            symbol={currencySymbol}
            errors={errors}
            disabled={disabled}
            removedCount={removed.size}
            onChange={fn => onChange(s => ({...s, variants: fn(s.variants)}))}
            onRemove={removeVariants}
            onRestore={restore}
          />
        ) : (
          <p className="vs-none muted">Without options the product sells as one item. Set its stock and SKU under Inventory.</p>
        )}
        {errors.variants && (
          <p role="alert" className="vs-error">
            {errors.variants}
          </p>
        )}
      </Card>
    </div>
  );
}

/* ---------- Options ---------- */

function OptionSummary({
  def: d,
  disabled,
  first,
  last,
  onEdit,
  onMove,
}: {
  def: OptionDef;
  disabled?: boolean;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <li className="vs-option">
      <span className="vs-move">
        <MoveButton label={`Move ${labelOf(d)} up`} up disabled={disabled || first} onClick={() => onMove(-1)} />
        <MoveButton label={`Move ${labelOf(d)} down`} disabled={disabled || last} onClick={() => onMove(1)} />
      </span>
      <button type="button" className="vs-option-edit" onClick={onEdit} disabled={disabled} aria-label={`Edit ${labelOf(d)} option`}>
        <span className="vs-option-text">
          <span className="vs-option-name">
            {labelOf(d)}
            {d.kind === 'custom' && <Badge>Custom</Badge>}
          </span>
          <span className="vs-chips">
            {d.values.length ? (
              d.values.map(v => (
                <span key={v.name} className="vs-chip">
                  {d.kind === 'color' && <Swatch hex={v.hex ?? NEUTRAL} />}
                  {v.name}
                </span>
              ))
            ) : (
              <span className="muted">No values yet</span>
            )}
          </span>
        </span>
        <Icon name="pencil" size={14} className="vs-option-pencil" />
      </button>
    </li>
  );
}

function MoveButton({label, up, disabled, onClick}: {label: string; up?: boolean; disabled?: boolean; onClick: () => void}) {
  return (
    <button type="button" className="vs-move-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name={up ? 'chevron-up' : 'chevron-down'} size={14} />
    </button>
  );
}

function OptionEditor({
  def: d,
  others,
  disabled,
  onRename,
  onAdd,
  onRemove,
  onRenameValue,
  onRecolour,
  onMove,
  onDelete,
  onDone,
}: {
  def: OptionDef;
  others: OptionDef[];
  disabled?: boolean;
  onRename: (name: string) => boolean;
  onAdd: (values: string[]) => void;
  onRemove: (name: string) => void;
  onRenameValue: (from: string, to: string) => void;
  onRecolour: (name: string, hex: string) => void;
  onMove: (name: string, dir: -1 | 1) => void;
  onDelete: () => void;
  /** `named`: the option has a name (custom options can be closed before one is saved). */
  onDone: (named: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(d.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const custom = d.kind === 'custom';
  const values = d.values.map(v => v.name);
  const pool = d.kind === 'color' ? Object.keys(KNOWN_SWATCHES) : d.kind === 'size' ? SIZE_SUGGESTIONS : [];
  const q = text.trim().toLowerCase();
  const suggestions = pool.filter(s => !values.some(v => same(v, s)) && (!q || s.toLowerCase().includes(q))).slice(0, 8);
  const exact = !!q && [...pool, ...values].some(s => s.toLowerCase() === q);
  const named = !custom || !!d.name.trim();
  const nameSuggestions = CUSTOM_NAMES.filter(n => !others.some(o => same(o.name, n)) && !same(n, d.name));
  const listId = `${d.id}-suggestions`;

  const commit = (raw = text) => {
    const parts = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length) onAdd(parts);
    setText('');
    // Close the list so it never sits over Done; typing opens it again.
    setOpen(false);
    input.current?.focus();
  };

  /** Saves the option name; false when it is empty or taken. */
  const commitName = (raw = nameDraft): boolean => {
    const name = title(raw);
    if (!name) {
      setNameError('Name the option, e.g. Fabric');
      return false;
    }
    if (others.some(o => same(o.name, name))) {
      setNameError('Another option already has that name');
      return false;
    }
    setNameError(null);
    setNameDraft(name);
    return name === d.name || onRename(name);
  };

  const placeholder = values.length
    ? 'Add another value'
    : d.kind === 'color'
      ? 'Add a colour, e.g. Camel'
      : d.kind === 'size'
        ? 'Add a size, e.g. M'
        : `Add a ${d.name.toLowerCase()}, e.g. ${d.name === 'Fabric' ? 'Canvas' : 'value'}`;

  return (
    <li className="vs-editor">
      {custom ? (
        <div className="field" data-invalid={nameError ? '' : undefined}>
          <label htmlFor={`opt-name-${d.id}`}>Option name</label>
          <input
            id={`opt-name-${d.id}`}
            value={nameDraft}
            disabled={disabled}
            autoFocus={!d.name}
            maxLength={40}
            autoComplete="off"
            placeholder="e.g. Fabric, Length, Fit"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `opt-name-${d.id}-error` : undefined}
            onChange={e => {
              setNameDraft(e.target.value);
              setNameError(null);
            }}
            onBlur={() => nameDraft.trim() && commitName()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitName();
              }
            }}
          />
          {nameError ? (
            <p role="alert" className="field-error" id={`opt-name-${d.id}-error`}>
              {nameError}
            </p>
          ) : (
            !d.name && (
              <div className="vs-picks">
                <span className="muted">Common:</span>
                {nameSuggestions.map(n => (
                  <button key={n} type="button" className="vs-pick" onMouseDown={e => e.preventDefault()} onClick={() => commitName(n)}>
                    {n}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      ) : (
        <div className="vs-editor-head">
          <span className="vs-option-name">{KIND_LABEL[d.kind as 'color' | 'size']}</span>
          <span className="muted">{pluralize(values.length, 'value')}</span>
        </div>
      )}

      {named && (
        <>
          {values.length > 0 && (
            <div className="vs-values">
              {custom && <span className="vs-label">Values</span>}
              <ol>
                {d.values.map((v, i) => (
                  <li key={v.name}>
                    <span className="vs-move">
                      <MoveButton label={`Move ${v.name} up`} up disabled={disabled || i === 0} onClick={() => onMove(v.name, -1)} />
                      <MoveButton label={`Move ${v.name} down`} disabled={disabled || i === values.length - 1} onClick={() => onMove(v.name, 1)} />
                    </span>
                    {d.kind === 'color' && (
                      <label className="vs-colour" title={`Swatch for ${v.name}`}>
                        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
                          <rect width="26" height="26" fill={v.hex ?? NEUTRAL} />
                        </svg>
                        <input
                          type="color"
                          value={(v.hex ?? NEUTRAL).toLowerCase()}
                          disabled={disabled}
                          onChange={e => onRecolour(v.name, e.target.value.toUpperCase())}
                          aria-label={`Swatch colour for ${v.name}`}
                        />
                      </label>
                    )}
                    <RenameInput
                      value={v.name}
                      label={`${labelOf(d)} value ${i + 1}`}
                      disabled={disabled}
                      onCommit={to => onRenameValue(v.name, to)}
                    />
                    <IconButton icon="trash" label={`Remove ${v.name}`} disabled={disabled} onClick={() => onRemove(v.name)} />
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="vs-add-value">
            <input
              ref={input}
              value={text}
              disabled={disabled}
              autoFocus={!!d.name}
              maxLength={60}
              autoComplete="off"
              role="combobox"
              aria-expanded={open && !!q}
              aria-controls={listId}
              aria-autocomplete="list"
              onChange={e => {
                setText(e.target.value);
                setOpen(true);
              }}
              onBlur={() => window.setTimeout(() => setOpen(false), 120)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape' && open) {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder={placeholder}
              aria-label={`Add ${labelOf(d).toLowerCase()} values`}
              aria-describedby={`${d.id}-value-hint`}
            />
            {/* While typing only: matches plus "Add …". It closes once a value is added, so it never covers Done. */}
            {open && q && (suggestions.length > 0 || !exact) && (
              <div className="vs-suggest" id={listId} role="listbox" aria-label="Suggestions">
                {suggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => commit(s)}>
                    {d.kind === 'color' && <Swatch hex={KNOWN_SWATCHES[s]} size={14} />}
                    {s}
                  </button>
                ))}
                {!exact && (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    data-divided={suggestions.length > 0 ? '' : undefined}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => commit()}>
                    <Icon name="plus" size={14} />
                    Add “{text.trim()}”
                  </button>
                )}
              </div>
            )}
          </div>
          <p id={`${d.id}-value-hint`} className="vs-hint">
            Press Enter to add. Separate several with commas.
          </p>

          {/* Quick picks sit in the page, never over other controls. */}
          {d.kind !== 'custom' && (
            <div className="vs-picks">
              <span className="muted">{d.kind === 'size' ? 'Quick add:' : 'Suggested:'}</span>
              {d.kind === 'size'
                ? SIZE_PRESETS.map(p => (
                    <button key={p.label} type="button" className="vs-pick" data-dashed="" disabled={disabled} onClick={() => onAdd(p.sizes)}>
                      <Icon name="plus" size={14} />
                      {p.label}
                    </button>
                  ))
                : pool
                    .filter(s => !values.some(v => same(v, s)))
                    .map(s => (
                      <button key={s} type="button" className="vs-pick" disabled={disabled} onClick={() => onAdd([s])}>
                        <Swatch hex={KNOWN_SWATCHES[s]} />
                        {s}
                      </button>
                    ))}
            </div>
          )}
        </>
      )}

      <div className="vs-editor-foot">
        <Button variant="ghost" size="sm" className="vs-danger-text" onClick={onDelete} disabled={disabled}>
          Delete option
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => {
            // A name still being typed is saved first; an option without a name or values is dropped.
            if (custom && title(nameDraft) !== d.name) {
              if (!commitName()) return;
              onDone(true);
            } else onDone(named);
          }}>
          Done
        </Button>
      </div>
    </li>
  );
}

/** A value's name, committed on blur or Enter so renames do not churn the variant rows per keystroke. */
function RenameInput({value, label, disabled, onCommit}: {value: string; label: string; disabled?: boolean; onCommit: (v: string) => void}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <input
      className="vs-input vs-grow"
      value={draft}
      disabled={disabled}
      maxLength={60}
      autoComplete="off"
      aria-label={label}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => (draft.trim() ? onCommit(draft) : setDraft(value))}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/* ---------- Variant table ---------- */

interface Group {
  key: string;
  label: string;
  hex: string | null;
  rows: VariantItem[];
}

/** Duplicate effective SKUs (case-insensitive) among the rows: the uids that clash. */
export function duplicateSkus(variants: VariantItem[], baseSku: string): Set<string> {
  const seen = new Map<string, string[]>();
  for (const v of variants) {
    const k = effectiveSku(v, baseSku).toUpperCase();
    seen.set(k, [...(seen.get(k) ?? []), v.uid]);
  }
  return new Set([...seen.values()].filter(list => list.length > 1).flat());
}

function VariantTable({
  defs,
  variants,
  baseSku,
  productPrice,
  symbol,
  errors,
  disabled,
  removedCount,
  onChange,
  onRemove,
  onRestore,
}: {
  defs: OptionDef[];
  variants: VariantItem[];
  baseSku: string;
  productPrice: string;
  symbol: string;
  errors: FieldErrors;
  disabled?: boolean;
  removedCount: number;
  onChange: (update: (prev: VariantItem[]) => VariantItem[]) => void;
  onRemove: (uids: ReadonlySet<string>) => void;
  onRestore: () => void;
}) {
  const grouped = defs.length >= 2;
  const [groupId, setGroupId] = useState<string>(defs[0]?.id ?? '');
  const groupDef = defs.find(d => d.id === groupId) ?? defs[0];
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const groupSelectId = useId();

  const index = useMemo(() => new Map(variants.map((v, i) => [v.uid, i])), [variants]);
  const dupes = useMemo(() => duplicateSkus(variants, baseSku), [variants, baseSku]);
  const live = new Set(variants.map(v => v.uid));
  const picked = new Set([...selected].filter(u => live.has(u)));
  const rest = defs.filter(d => d !== groupDef);

  const groups: Group[] | null = useMemo(() => {
    if (!grouped || !groupDef) return null;
    return groupDef.values
      .map(val => ({
        key: val.name,
        label: val.name,
        hex: groupDef.kind === 'color' ? (val.hex ?? NEUTRAL) : null,
        rows: variants.filter(r => valueOf(r, groupDef) === val.name),
      }))
      .filter(g => g.rows.length > 0);
  }, [grouped, groupDef, variants]);

  const patch = (uids: ReadonlySet<string>, p: Partial<VariantItem> | ((v: VariantItem) => Partial<VariantItem>)) =>
    onChange(prev => prev.map(v => (uids.has(v.uid) ? {...v, ...(typeof p === 'function' ? p(v) : p)} : v)));

  const toggle = (uids: string[], on: boolean) =>
    setSelected(s => {
      const n = new Set(s);
      for (const u of uids) {
        if (on) n.add(u);
        else n.delete(u);
      }
      return n;
    });

  const total = variants.reduce((n, v) => n + (Number(v.inventory) || 0), 0);
  const out = variants.filter(v => (Number(v.inventory) || 0) === 0).length;
  const allOn = picked.size > 0 && picked.size === variants.length;
  // "Out of stock" only means something once some variants have stock (not on a new product still at zero).
  const flagEmpty = total > 0;

  const swatchOf = (v: VariantItem, among: OptionDef[]) => (among.some(d => d.kind === 'color') ? v.swatch : null);
  const rowLabel = (v: VariantItem, among: OptionDef[]) =>
    among
      .map(d => valueOf(v, d))
      .filter(Boolean)
      .join(' / ');

  const rowProps = (v: VariantItem, among: OptionDef[], nested?: boolean) => ({
    v,
    label: rowLabel(v, among) || 'Default',
    hex: swatchOf(v, among),
    nested,
    baseSku,
    productPrice,
    symbol,
    errors,
    duplicate: dupes.has(v.uid),
    index: index.get(v.uid) ?? 0,
    picked: picked.has(v.uid),
    disabled,
    flagEmpty,
    onPick: (on: boolean) => toggle([v.uid], on),
    onPatch: (p: Partial<VariantItem>) => patch(new Set([v.uid]), p),
    onRemove: () => onRemove(new Set([v.uid])),
  });

  return (
    <div className="vs-table-block">
      <div className="vs-table-bar">
        {picked.size > 0 ? (
          <BulkActions
            count={picked.size}
            productPrice={productPrice}
            symbol={symbol}
            disabled={disabled}
            onPrice={price => patch(picked, {price})}
            onStock={fn => patch(picked, v => ({inventory: String(fn(Number(v.inventory) || 0))}))}
            onDelete={() => {
              onRemove(picked);
              setSelected(new Set());
            }}
            onClear={() => setSelected(new Set())}
          />
        ) : grouped ? (
          <span className="vs-group-by">
            <label htmlFor={groupSelectId}>Group by</label>
            <Select
              id={groupSelectId}
              aria-label="Group variants by"
              value={groupDef?.id ?? ''}
              onChange={e => setGroupId(e.target.value)}
              options={defs.map(d => ({value: d.id, label: labelOf(d)}))}
            />
          </span>
        ) : (
          <span className="muted">{pluralize(variants.length, 'variant')}</span>
        )}
        {groups && picked.size === 0 && (
          <button
            type="button"
            className="vs-link"
            onClick={() => setCollapsed(c => (c.size ? new Set() : new Set(groups.map(g => g.key))))}>
            {collapsed.size ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      <div className="table-wrap vs-scroll">
        <table className="vs-table">
          <caption className="visually-hidden">Variants</caption>
          <thead>
            <tr>
              <th scope="col" className="vs-col-check">
                <RowCheck
                  label={allOn ? 'Deselect all variants' : 'Select all variants'}
                  checked={allOn}
                  indeterminate={picked.size > 0}
                  onChange={() => setSelected(allOn ? new Set() : new Set(variants.map(v => v.uid)))}
                  disabled={disabled}
                />
              </th>
              <th scope="col">Variant</th>
              <th scope="col" className="vs-col-price" title="Empty prices use the product price">
                Price
              </th>
              <th scope="col" className="vs-col-stock">
                Available
              </th>
              <th scope="col" className="vs-col-sku">
                SKU
              </th>
              <th scope="col" className="vs-col-remove">
                <span className="visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map(g => {
                  const open = !collapsed.has(g.key);
                  const uids = g.rows.map(r => r.uid);
                  const on = uids.filter(u => picked.has(u)).length;
                  const own = [...new Set(g.rows.map(r => r.price))];
                  const prices = g.rows.map(r => Number(effectivePrice(r, productPrice))).filter(Number.isFinite);
                  const stock = g.rows.reduce((n, r) => n + (Number(r.inventory) || 0), 0);
                  const lo = Math.min(...prices);
                  const hi = Math.max(...prices);
                  return (
                    <Fragment key={g.key}>
                      <tr className="vs-group">
                        <td>
                          <RowCheck
                            label={`Select all ${g.label} variants`}
                            checked={on === uids.length}
                            indeterminate={on > 0}
                            onChange={() => toggle(uids, on !== uids.length)}
                            disabled={disabled}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="vs-group-toggle"
                            aria-expanded={open}
                            onClick={() =>
                              setCollapsed(c => {
                                const n = new Set(c);
                                if (open) n.add(g.key);
                                else n.delete(g.key);
                                return n;
                              })
                            }>
                            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                            {g.hex && <Swatch hex={g.hex} size={16} />}
                            <span className="vs-group-text">
                              <span className="vs-group-label">{g.label}</span>
                              <span className="muted">{pluralize(g.rows.length, 'variant')}</span>
                            </span>
                          </button>
                        </td>
                        <td>
                          <MoneyCell
                            value={own.length === 1 ? own[0]! : ''}
                            placeholder={own.length === 1 ? productPrice : lo === hi ? String(lo) : `${lo}–${hi}`}
                            label={`Price for all ${g.label}`}
                            symbol={symbol}
                            disabled={disabled}
                            onChange={price => patch(new Set(uids), {price})}
                          />
                        </td>
                        <td className="vs-sum">{stock}</td>
                        <td />
                        <td />
                      </tr>
                      {open && g.rows.map(v => <VariantRow key={v.uid} {...rowProps(v, rest, true)} />)}
                    </Fragment>
                  );
                })
              : variants.map(v => <VariantRow key={v.uid} {...rowProps(v, defs)} />)}
          </tbody>
        </table>
      </div>

      <div className="vs-foot">
        <span className="vs-total">
          Total inventory: <strong>{total}</strong> available
          {flagEmpty && out > 0 && <span className="vs-warn"> · {out} out of stock</span>}
        </span>
        <span className="vs-foot-end">
          <span>Empty prices use the product price.</span>
          {removedCount > 0 && !disabled && (
            <button type="button" className="vs-link" onClick={onRestore}>
              Restore {pluralize(removedCount, 'removed variant')}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function VariantRow({
  v,
  label,
  hex,
  nested,
  baseSku,
  productPrice,
  symbol,
  errors,
  duplicate,
  index,
  picked,
  disabled,
  flagEmpty,
  onPick,
  onPatch,
  onRemove,
}: {
  v: VariantItem;
  label: string;
  hex: string | null;
  nested?: boolean;
  baseSku: string;
  productPrice: string;
  symbol: string;
  errors: FieldErrors;
  duplicate: boolean;
  index: number;
  picked: boolean;
  disabled?: boolean;
  flagEmpty?: boolean;
  onPick: (on: boolean) => void;
  onPatch: (p: Partial<VariantItem>) => void;
  onRemove: () => void;
}) {
  const err = (k: string) => errors[`variants.${index}.${k}`];
  const skuError = err('id') ?? (duplicate ? 'Duplicate SKU' : undefined);
  const rowError = [skuError, err('price'), err('inventory')].find(Boolean);
  const stock = Number(v.inventory) || 0;
  const errorId = `variant-${v.uid}-error`;
  return (
    <tr className="vs-row" data-picked={picked ? '' : undefined} data-testid="variant-row">
      <td>
        <RowCheck label={`Select ${label}`} checked={picked} onChange={onPick} disabled={disabled} />
      </td>
      <td className={nested ? 'vs-nested' : undefined}>
        <span className="vs-row-label">
          {hex && <Swatch hex={hex} size={14} />}
          <span>{label}</span>
          {flagEmpty && stock === 0 && <span className="vs-warn">Out of stock</span>}
        </span>
        {rowError && (
          <p role="alert" className="vs-row-error" id={errorId}>
            {rowError}
          </p>
        )}
      </td>
      <td>
        <MoneyCell
          value={v.price}
          placeholder={productPrice}
          label={`Price for ${label}`}
          symbol={symbol}
          invalid={!!err('price')}
          disabled={disabled}
          onChange={price => onPatch({price})}
        />
      </td>
      <td>
        <input
          className="vs-input vs-num"
          inputMode="numeric"
          autoComplete="off"
          value={v.inventory}
          disabled={disabled}
          aria-label={`Available for ${label}`}
          aria-invalid={err('inventory') ? true : undefined}
          aria-describedby={err('inventory') ? errorId : undefined}
          onChange={e => onPatch({inventory: e.target.value.replace(/[^\d]/g, '')})}
          onFocus={e => e.target.select()}
        />
      </td>
      <td>
        <input
          className="vs-input vs-sku"
          value={v.id}
          disabled={disabled}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          placeholder={variantSku(baseSku, v.color, v.size, Object.values(v.options ?? {}))}
          aria-label={`SKU for ${label}`}
          aria-invalid={skuError ? true : undefined}
          aria-describedby={skuError ? errorId : undefined}
          title={effectiveSku(v, baseSku)}
          onChange={e => onPatch({id: e.target.value.toUpperCase().replace(/\s+/g, '')})}
        />
      </td>
      <td className="vs-col-remove">
        <IconButton icon="trash" size="sm" label={`Remove ${label}`} disabled={disabled} onClick={onRemove} />
      </td>
    </tr>
  );
}

/**
 * Price cell. Empty shows the product price it falls back to; a price set here gets a reset
 * button, so overrides stand out and are one click from following the product again.
 */
function MoneyCell({
  value,
  placeholder,
  label,
  symbol,
  invalid,
  disabled,
  onChange,
}: {
  value: string;
  placeholder?: string;
  label: string;
  symbol: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const own = value !== '';
  return (
    <span className="vs-money" data-own={own ? '' : undefined}>
      <MoneyInput
        value={value}
        symbol={symbol}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={!own && placeholder ? `${label} (uses ${placeholder})` : label}
        aria-invalid={invalid || undefined}
        onChange={e => onChange(e.target.value)}
        onFocus={e => e.target.select()}
      />
      {own && !disabled && (
        <button type="button" className="vs-reset" onClick={() => onChange('')} aria-label={`${label}: use the product price`} title="Use the product price">
          <Icon name="rotate-ccw" size={14} />
        </button>
      )}
    </span>
  );
}

/* ---------- Bulk actions ---------- */

function BulkActions({
  count,
  productPrice,
  symbol,
  disabled,
  onPrice,
  onStock,
  onDelete,
  onClear,
}: {
  count: number;
  productPrice: string;
  symbol: string;
  disabled?: boolean;
  onPrice: (price: string) => void;
  onStock: (fn: (n: number) => number) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="vs-bulk" role="toolbar" aria-label="Selected variants">
      <span className="vs-bulk-count">{count} selected</span>
      <BulkInput
        label="Set price"
        placeholder={productPrice || '0.00'}
        kind="money"
        symbol={symbol}
        disabled={disabled}
        onApply={v => onPrice(v)}
        extra={close => (
          <button
            type="button"
            className="vs-link"
            onClick={() => {
              onPrice('');
              close();
            }}>
            Use the product price{productPrice ? ` (${symbol}${productPrice})` : ''}
          </button>
        )}
      />
      <BulkInput
        label="Set stock"
        placeholder="0"
        kind="count"
        disabled={disabled}
        onApply={v => onStock(() => Math.max(0, Math.floor(Number(v) || 0)))}
      />
      <BulkInput
        label="Adjust stock"
        placeholder="+5 or -2"
        kind="signed"
        disabled={disabled}
        onApply={v => onStock(n => Math.max(0, n + Math.trunc(Number(v) || 0)))}
      />
      <Button variant="ghost" size="sm" icon="trash" className="vs-danger-text" onClick={onDelete} disabled={disabled}>
        Remove
      </Button>
      <IconButton icon="x" size="sm" label="Clear selection" onClick={onClear} />
    </div>
  );
}

/** What a bulk value may be: money (digits, one dot), a count (digits), or a signed whole number. */
export function bulkValueValid(kind: 'money' | 'count' | 'signed', raw: string): boolean {
  const v = raw.trim();
  if (kind === 'money') return /^\d+(\.\d{0,2})?$/.test(v) || /^\.\d{1,2}$/.test(v);
  if (kind === 'count') return /^\d+$/.test(v);
  return /^[+-]?\d+$/.test(v) && Number(v) !== 0;
}

function BulkInput({
  label,
  placeholder,
  kind,
  symbol = '$',
  disabled,
  onApply,
  extra,
}: {
  label: string;
  placeholder: string;
  kind: 'money' | 'count' | 'signed';
  symbol?: string;
  disabled?: boolean;
  onApply: (v: string) => void;
  /** More in the popover, e.g. "Use the product price". */
  extra?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const valid = bulkValueValid(kind, v);
  const close = () => setOpen(false);
  const apply = () => {
    if (!valid) return;
    onApply(v.trim());
    setV('');
    setOpen(false);
    anchor.current?.focus();
  };
  const clean = (raw: string) => (kind === 'money' ? cleanAmount(raw) : kind === 'signed' ? raw.replace(/[^\d+-]/g, '') : raw.replace(/[^\d]/g, ''));
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="vs-bulk-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-open={open ? '' : undefined}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}>
        {label}
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover open={open} onClose={close} anchor={anchor} label={label} className="vs-popover">
        {/* Not a <form>: this sits inside the product editor's form. Enter applies. */}
        <div className="vs-popover-row">
          {kind === 'money' ? (
            <MoneyInput
              value={v}
              symbol={symbol}
              placeholder={placeholder}
              aria-label={label}
              onChange={e => setV(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply();
                }
              }}
            />
          ) : (
            <input
              className="vs-input vs-num"
              inputMode={kind === 'signed' ? 'text' : 'numeric'}
              autoComplete="off"
              value={v}
              placeholder={placeholder}
              aria-label={label}
              onChange={e => setV(clean(e.target.value))}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply();
                }
              }}
            />
          )}
          <IconButton icon="check" size="sm" variant="primary" label={`Apply: ${label}`} disabled={!valid} onClick={apply} />
        </div>
        {extra?.(close)}
      </Popover>
    </>
  );
}
