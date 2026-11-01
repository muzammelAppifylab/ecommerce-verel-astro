import {type KeyboardEvent, useState} from 'react';

import {Button, Field, IconButton} from '../../ui';
import {SETTINGS_LIMITS as L} from './limits';
import {type Errors, fieldAria, isWhole, Section, type SettingsCodec, SettingsShell, ToggleRow, useSettingsDraft} from './shared';

/** Settings · Inventory and returns (port of VAREL `InventorySettings.tsx`): low stock, sold-out products, return window and reasons, shipping refunds. */

interface InventoryForm {
  lowStockThreshold: string;
  hideSoldOut: boolean;
  returnWindowDays: string;
  returnReasons: string[];
  refundShipping: boolean;
}

export const inventoryCodec: SettingsCodec<InventoryForm> = {
  toForm: s => ({
    lowStockThreshold: String(s.lowStockThreshold),
    hideSoldOut: s.hideSoldOut,
    returnWindowDays: String(s.returnWindowDays),
    returnReasons: [...s.returnReasons],
    refundShipping: s.refundShipping,
  }),
  toValues: f => ({
    lowStockThreshold: Number(f.lowStockThreshold),
    hideSoldOut: f.hideSoldOut,
    returnWindowDays: Number(f.returnWindowDays),
    returnReasons: f.returnReasons.map(r => r.trim()).filter(Boolean),
    refundShipping: f.refundShipping,
  }),
  validate: f => {
    const e: Errors = {};
    if (!isWhole(f.lowStockThreshold, L.lowStockThreshold)) e.lowStockThreshold = 'Enter a whole number, zero or more.';
    if (!isWhole(f.returnWindowDays, L.returnWindowDays)) e.returnWindowDays = `Enter whole days from 0 to ${L.returnWindowDays}.`;
    if (f.returnReasons.some(r => r.trim().length > L.returnReason)) e.returnReasons = `Keep each reason under ${L.returnReason} characters.`;
    else if (f.returnReasons.filter(r => r.trim()).length > L.returnReasons) e.returnReasons = `Keep it to ${L.returnReasons} reasons or fewer`;
    return e;
  },
};

export function InventorySettings() {
  const draft = useSettingsDraft(inventoryCodec);
  const {set, touch, errors, ro} = draft;
  return (
    <SettingsShell title="Inventory and returns" description="When stock counts as low, what happens when it runs out, and how returns work." draft={draft}>
      {f => (
        <>
          <Section id="stock" title="Stock" description="Thresholds for the storefront stock labels and the admin inventory view.">
            <div className="settings-narrow">
              <Field
                label="Low-stock threshold"
                id="s-lowstock"
                error={errors.lowStockThreshold}
                hint={`Variants with ${f.lowStockThreshold || 0} or fewer left show as low stock`}>
                <input
                  id="s-lowstock"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={L.lowStockThreshold}
                  step={1}
                  value={f.lowStockThreshold}
                  onChange={e => set({lowStockThreshold: e.target.value})}
                  onBlur={() => touch('lowStockThreshold')}
                  {...fieldAria('s-lowstock', errors.lowStockThreshold)}
                />
              </Field>
            </div>
            <ToggleRow
              label="Hide sold-out products"
              description="Removes products with no stock in any size from listings and search. Their pages still open from a link. Made-to-order products stay visible."
              checked={f.hideSoldOut}
              onChange={hideSoldOut => set({hideSoldOut})}
              disabled={ro}
            />
          </Section>

          <Section id="returns" title="Returns" description="What customers see on the returns page and how refunds are worked out.">
            <div className="settings-narrow">
              <Field
                label="Return window (days)"
                id="s-returns"
                error={errors.returnWindowDays}
                hint={Number(f.returnWindowDays) === 0 ? '0 turns off online return requests' : 'Days after delivery a return can be requested'}>
                <input
                  id="s-returns"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={L.returnWindowDays}
                  step={1}
                  value={f.returnWindowDays}
                  onChange={e => set({returnWindowDays: e.target.value})}
                  onBlur={() => touch('returnWindowDays')}
                  {...fieldAria('s-returns', errors.returnWindowDays)}
                />
              </Field>
            </div>
            <ReasonsEditor value={f.returnReasons} onChange={returnReasons => set({returnReasons})} error={errors.returnReasons} disabled={ro} />
            <ToggleRow
              label="Refund shipping on full returns"
              description="When every item in an order is refunded, the shipping charge is refunded too."
              checked={f.refundShipping}
              onChange={refundShipping => set({refundShipping})}
              disabled={ro}
            />
          </Section>
        </>
      )}
    </SettingsShell>
  );
}

/** An ordered, inline-editable list of return reasons. Its Add field never submits the settings form. */
export function ReasonsEditor({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const exists = (r: string) => value.some(v => v.trim().toLowerCase() === r.trim().toLowerCase());
  const full = value.length >= L.returnReasons;
  const add = () => {
    const r = text.trim();
    if (!r || exists(r) || full) return;
    onChange([...value, r.slice(0, L.returnReason)]);
    setText('');
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };
  const noEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  return (
    <div className="settings-stack">
      <p id="s-reasons-label" className="settings-label">
        Return reasons
      </p>
      {value.length ? (
        <ol aria-labelledby="s-reasons-label" className="settings-reasons">
          {value.map((r, i) => (
            <li key={i} className="settings-reason">
              <span className="settings-reason-index">{i + 1}</span>
              <input
                aria-label={`Reason ${i + 1}`}
                value={r}
                maxLength={L.returnReason}
                onChange={e => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
                onKeyDown={noEnter}
              />
              {!disabled && (
                <span className="settings-inline">
                  <IconButton icon="chevron-up" size="sm" label={`Move “${r}” up`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon="chevron-down" size="sm" label={`Move “${r}” down`} disabled={i === value.length - 1} onClick={() => move(i, 1)} />
                  <IconButton icon="x" size="sm" label={`Remove “${r}”`} onClick={() => onChange(value.filter((_, j) => j !== i))} />
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="settings-empty-line">No reasons listed. The returns form keeps the default reasons.</p>
      )}
      {!disabled && (
        <span className="settings-inline settings-grow">
          <input
            id="s-reason-new"
            aria-label="New return reason"
            className="settings-input"
            value={text}
            maxLength={L.returnReason}
            placeholder={full ? `Up to ${L.returnReasons} reasons` : 'e.g. Too small'}
            disabled={full}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button variant="secondary" size="sm" icon="plus" disabled={!text.trim() || exists(text) || full} onClick={add}>
            Add
          </Button>
        </span>
      )}
      {error ? (
        <p className="field-error" role="alert" aria-invalid="true">
          {error}
        </p>
      ) : (
        <p className="field-hint">The options customers choose from on the returns form, in this order.</p>
      )}
    </div>
  );
}
