import {useQuery} from '@tanstack/react-query';
import {type KeyboardEvent, useState} from 'react';

import type {AdminTaxRate} from '../../../lib/types/admin/store';
import {COUNTRIES} from '../../../server/lib/countries';
import {ApiError} from '../../api';
import {taxRatesQuery, useCreateTaxRate, useDeleteTaxRate, useUpdateTaxRate} from '../../queries/settings';
import {Button, type Column, DataTable, Field, Menu, Modal, Notice, Select, useConfirm, useToast} from '../../ui';
import {SETTINGS_LIMITS as L} from './limits';
import {type Errors, fieldAria, firstProblem, fromPercent, isAmount, toPercent, useCanEditSettings} from './shared';

/**
 * Settings · Tax · Rates by country (port of `CountryRates` in VAREL `TaxSettings.tsx`). Its own
 * reads and writes, saved straight away, never part of the settings draft. It sits inside the settings
 * `<form>`: every button is `type="button"` and Enter in the dialog saves the dialog only.
 */

interface RateDraft {
  id?: string;
  country: string;
  name: string;
  percent: string;
}

export function CountryRates({defaultName}: {defaultName: string}) {
  const canWrite = useCanEditSettings();
  const rates = useQuery(taxRatesQuery);
  const create = useCreateTaxRate();
  const update = useUpdateTaxRate();
  const del = useDeleteTaxRate();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState<RateDraft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [tried, setTried] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = [...(rates.data ?? [])].sort((a, b) => a.country.localeCompare(b.country));
  const used = new Set(list.map(r => r.country));
  const pending = create.isPending || update.isPending;

  function check(d: RateDraft): Errors {
    const e: Errors = {};
    if (!d.country.trim()) e.country = 'Choose a country.';
    else if (list.some(r => r.country === d.country && r.id !== d.id)) e.country = 'This country already has a rate.';
    if (!d.name.trim()) e.name = 'Enter a name.';
    else if (d.name.trim().length > L.taxName) e.name = `Keep the tax name under ${L.taxName} characters`;
    if (!isAmount(d.percent, 100)) e.rate = 'Enter 0 to 100.';
    return e;
  }

  const open = (d: RateDraft) => {
    setEditing(d);
    setErrors({});
    setTried(false);
    setFormError(null);
  };
  const change = (p: Partial<RateDraft>) => {
    if (!editing) return;
    const next = {...editing, ...p};
    setEditing(next);
    if (tried) setErrors(check(next));
    else {
      const keys = Object.keys(p).map(k => (k === 'percent' ? 'rate' : k));
      setErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))));
    }
  };
  const blur = (key: string) => () => {
    if (!editing) return;
    const all = check(editing);
    setErrors(prev => (all[key] ? {...prev, [key]: all[key]!} : prev));
  };

  async function save() {
    if (!editing || pending) return;
    setTried(true);
    setFormError(null);
    const e = check(editing);
    setErrors(e);
    const first = ['country', 'name', 'rate'].find(k => e[k]);
    if (first) return document.getElementById(`rate-${first}`)?.focus();
    const body = {country: editing.country, name: editing.name.trim(), rate: fromPercent(editing.percent)};
    try {
      const r = editing.id ? await update.mutateAsync({id: editing.id, ...body}) : await create.mutateAsync(body);
      toast.success(editing.id ? `${r.country} rate saved` : `${r.country} rate added`);
      setEditing(null);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setFormError(firstProblem(err));
    }
  }

  const remove = (r: AdminTaxRate) =>
    void confirm({
      title: `Remove the ${r.country} rate?`,
      body: 'Orders shipping there will use the default rate. Placed orders keep the tax they were charged.',
      confirmLabel: 'Remove',
      pendingLabel: 'Removing…',
      action: async () => {
        setBusyId(r.id);
        try {
          await del.mutateAsync(r.id);
        } catch (e) {
          throw new Error(firstProblem(e));
        } finally {
          setBusyId(null);
        }
      },
    }).then(ok => ok && toast.success(`${r.country} rate removed`));

  // Enter saves the dialog, never the settings form around it.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      void save();
    }
  };

  const options = (current?: string) => [
    {value: '', label: 'Choose a country'},
    ...COUNTRIES.filter(c => c === current || !used.has(c)).map(c => ({value: c, label: c})),
  ];

  const columns: Column<AdminTaxRate>[] = [
    {key: 'country', header: 'Country', cell: r => r.country},
    {key: 'name', header: 'Name', cell: r => <span className="muted">{r.name}</span>},
    {key: 'rate', header: 'Rate', align: 'end', cell: r => <span className="settings-num">{toPercent(r.rate)}%</span>},
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: 'Actions',
            actions: true,
            cell: (r: AdminTaxRate) => (
              <Menu
                label={`Actions for ${r.country} rate`}
                disabled={busyId !== null}
                items={[
                  {label: 'Edit', icon: 'pencil', onSelect: () => open({id: r.id, country: r.country, name: r.name, percent: toPercent(r.rate)})},
                  {label: 'Remove', icon: 'trash', danger: true, onSelect: () => remove(r)},
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  if (rates.isError && !rates.data)
    return (
      <Notice
        tone="danger"
        action={
          <Button variant="secondary" size="sm" onClick={() => void rates.refetch()}>
            Try again
          </Button>
        }>
        Country rates could not be loaded. {firstProblem(rates.error)}
      </Notice>
    );

  return (
    <div className="settings-stack">
      <div className="settings-rates">
        <DataTable
          caption="Country rates"
          columns={columns}
          rows={rates.data ? list : undefined}
          rowKey={r => r.id}
          loading={rates.isLoading}
          busyKey={busyId}
          empty={<p className="settings-empty-line">No country rates yet. Every order uses the default rate.</p>}
        />
      </div>
      {canWrite && (
        <div>
          <Button variant="secondary" size="sm" icon="plus" disabled={rates.isLoading} onClick={() => open({country: '', name: defaultName, percent: ''})}>
            Add country rate
          </Button>
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        dismissible={!pending}
        size="sm"
        title={editing?.id ? 'Edit country rate' : 'Add country rate'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button pending={pending} pendingLabel="Saving…" onClick={() => void save()}>
              {editing?.id ? 'Save' : 'Add rate'}
            </Button>
          </>
        }>
        {editing && (
          <div className="form-stack" onKeyDown={onKeyDown}>
            <Field label="Country" id="rate-country" error={errors.country}>
              <Select
                id="rate-country"
                value={editing.country}
                options={options(editing.id ? editing.country : undefined)}
                onChange={e => change({country: e.target.value})}
                onBlur={blur('country')}
                {...fieldAria('rate-country', errors.country)}
              />
            </Field>
            <Field label="Name" id="rate-name" error={errors.name}>
              <input
                id="rate-name"
                value={editing.name}
                onChange={e => change({name: e.target.value})}
                onBlur={blur('name')}
                {...fieldAria('rate-name', errors.name)}
              />
            </Field>
            <Field label="Rate (%)" id="rate-rate" error={errors.rate}>
              <input
                id="rate-rate"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.01}
                value={editing.percent}
                onChange={e => change({percent: e.target.value})}
                onBlur={blur('rate')}
                {...fieldAria('rate-rate', errors.rate)}
              />
            </Field>
            {formError && <Notice tone="danger">{formError}</Notice>}
          </div>
        )}
      </Modal>
    </div>
  );
}
