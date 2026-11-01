/*
 * One menu: title, links with drag (or arrow-button) ordering, label and link editing.
 * Port of VAREL `src/pages/admin/navigation/MenuEditor.tsx` on the portal kit (`SortableList` replaces the
 * hand-rolled drag; drag starts only from the grip).
 */
import {useQueryClient} from '@tanstack/react-query';
import {useEffect, useId, useRef, useState} from 'react';

import {FALLBACK_MENUS} from '../../../components/layout/menus';
import type {AdminMenu} from '../../../lib/types/admin/content';
import {ApiError} from '../../api';
import {navigationKeys, saveMenu} from '../../queries/navigation';
import {Button, Card, Field, IconButton, SortableList, useToast} from '../../ui';
import {MENU_URL_OK} from './hero';

interface Row {
  key: string;
  label: string;
  url: string;
}

let seq = 0;
const rowKey = () => `r${(seq++).toString(36)}`;
const rowsOf = (m: AdminMenu): Row[] => (m.stored ? m.items : FALLBACK_MENUS[m.key].items).map(i => ({key: rowKey(), label: i.label, url: i.url}));
const sig = (title: string, rows: Row[]) => JSON.stringify([title, rows.map(r => [r.label, r.url])]);

const MAX_LINKS = 20;

const DESCRIPTIONS: Record<AdminMenu['key'], string> = {
  header: 'Desktop header and the mobile menu. Search, account, wishlist and bag stay fixed.',
  'footer-studio': 'First footer column.',
  'footer-shop': 'Second footer column.',
  'footer-help': 'Third footer column. A /login link reads “Account” for signed-in customers.',
};

export function MenuEditor({menu, readOnly}: {menu: AdminMenu; readOnly?: boolean}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(menu.title);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(menu));
  const [base, setBase] = useState(() => sig(menu.title, rowsOf(menu)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const isHeader = menu.key === 'header';
  const name = isHeader ? 'Header' : menu.title;

  // Fresh server copy (after a save elsewhere / refetch) resets an untouched editor.
  useEffect(() => {
    if (sig(title, rows) === base) {
      const r = rowsOf(menu);
      setTitle(menu.title);
      setRows(r);
      setBase(sig(menu.title, r));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.updatedAt]);

  const dirty = sig(title, rows) !== base || !menu.stored;
  const update = (i: number, patch: Partial<Row>) => {
    setRows(rs => rs.map((r, j) => (j === i ? {...r, ...patch} : r)));
    setErrors(({[`items.${i}.label`]: _a, [`items.${i}.url`]: _b, ...rest}) => rest);
  };
  const add = () => {
    setRows(rs => [...rs, {key: rowKey(), label: '', url: '/'}]);
    requestAnimationFrame(() => {
      const inputs = listRef.current?.querySelectorAll<HTMLInputElement>('.cms-menu-label input');
      inputs?.[inputs.length - 1]?.focus();
    });
  };
  const remove = (i: number) => {
    setRows(rs => rs.filter((_, j) => j !== i));
    setErrors({});
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Enter a title.';
    rows.forEach((r, i) => {
      if (!r.label.trim()) e[`items.${i}.label`] = 'Enter a label.';
      if (!MENU_URL_OK(r.url.trim())) e[`items.${i}.url`] = 'Start with / for a store page, or use a full https:// link.';
    });
    setErrors(e);
    if (Object.keys(e).length) {
      toast.danger('Check the highlighted links.');
      requestAnimationFrame(() => listRef.current?.closest('.card-panel')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    try {
      const m = await saveMenu({key: menu.key, title: title.trim(), items: rows.map(r => ({label: r.label.trim(), url: r.url.trim()}))});
      queryClient.setQueryData<AdminMenu[]>(navigationKeys.menus, all => all?.map(x => (x.key === m.key ? m : x)));
      const r = rowsOf(m);
      setRows(r);
      setTitle(m.title);
      setBase(sig(m.title, r));
      toast.success(`${isHeader ? 'Header' : m.title} menu saved`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      toast.danger(err instanceof Error && err.message ? err.message : 'The menu could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    const r = rowsOf(menu);
    setRows(r);
    setTitle(menu.title);
    setErrors({});
  };

  return (
    <Card
      title={isHeader ? 'Header' : `Footer · ${menu.title}`}
      description={DESCRIPTIONS[menu.key]}
      actions={
        !readOnly && (
          <>
            {dirty && menu.stored && (
              <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={() => void submit()} pending={saving} pendingLabel="Saving…" disabled={!dirty}>
              Save
            </Button>
          </>
        )
      }>
      <div className="cms-menu" ref={listRef}>
        {!menu.stored && <p className="cms-menu-note">The store shows its built-in links. Save to manage them here.</p>}
        {!isHeader && (
          <div className="cms-menu-heading">
            <Field label="Column heading" id={titleId} error={errors.title}>
              <input
                id={titleId}
                value={title}
                maxLength={60}
                disabled={readOnly || saving}
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={errors.title ? `${titleId}-error` : undefined}
                onChange={e => {
                  setTitle(e.target.value);
                  setErrors(({title: _t, ...rest}) => rest);
                }}
              />
            </Field>
          </div>
        )}

        {rows.length > 0 && (
          <SortableList
            label={`${name} links`}
            items={rows}
            getKey={r => r.key}
            getLabel={r => r.label || 'link'}
            disabled={readOnly || saving}
            onReorder={next => {
              setRows(next);
              setErrors({});
            }}
            renderItem={(r, i) => {
              const labelErr = errors[`items.${i}.label`];
              const urlErr = errors[`items.${i}.url`];
              const err = labelErr ?? urlErr;
              const errId = `${titleId}-row-${r.key}-error`;
              return (
                <div className="cms-menu-row">
                  <div className="cms-menu-inputs">
                    <div className="field cms-menu-label">
                      <label className="visually-hidden" htmlFor={`${titleId}-${r.key}-label`}>
                        Link {i + 1} label
                      </label>
                      <input
                        id={`${titleId}-${r.key}-label`}
                        value={r.label}
                        placeholder="Label"
                        maxLength={60}
                        disabled={readOnly || saving}
                        aria-invalid={labelErr ? true : undefined}
                        aria-describedby={err ? errId : undefined}
                        onChange={e => update(i, {label: e.target.value})}
                      />
                    </div>
                    <div className="field cms-menu-url">
                      <label className="visually-hidden" htmlFor={`${titleId}-${r.key}-url`}>
                        Link {i + 1} address
                      </label>
                      <input
                        id={`${titleId}-${r.key}-url`}
                        value={r.url}
                        placeholder="/shop/women/"
                        maxLength={500}
                        spellCheck={false}
                        disabled={readOnly || saving}
                        aria-invalid={urlErr ? true : undefined}
                        aria-describedby={err ? errId : undefined}
                        onChange={e => update(i, {url: e.target.value})}
                      />
                    </div>
                  </div>
                  {err && (
                    <p role="alert" className="field-error" id={errId}>
                      {err}
                    </p>
                  )}
                </div>
              );
            }}
            renderActions={
              readOnly
                ? undefined
                : (r, i) => <IconButton icon="trash" size="sm" label={`Remove ${r.label || 'link'}`} disabled={saving} onClick={() => remove(i)} />
            }
          />
        )}
        {rows.length === 0 && <p className="muted cms-small">No links. Saved empty, the store keeps showing its built-in links.</p>}
        {!readOnly && rows.length < MAX_LINKS && (
          <div>
            <Button variant="secondary" size="sm" icon="plus" onClick={add} disabled={saving}>
              Add link
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
