import {type FormEvent, useEffect, useState} from 'react';

import type {AdminShippingMethod, AdminShippingZone} from '../../../../lib/types/admin/store';
import {ApiError} from '../../../api';
import {useCreateMethod, useCreateZone, useUpdateMethod, useUpdateZone} from '../../../queries/settings';
import {Button, Field, Modal, MoneyInput, Notice, useToast} from '../../../ui';
import {SETTINGS_LIMITS as L} from '../limits';
import {fieldAria, firstProblem} from '../shared';
import {CountryChips} from './CountryChips';

/** Zone and method dialogs (port of VAREL `pages/admin/shipping/dialogs.tsx`). */

export const isCatchAll = (z: Pick<AdminShippingZone, 'countries'>) => z.countries.length === 0;
export const zoneLabel = (z: AdminShippingZone) => (isCatchAll(z) ? `${z.zone} · Everywhere else` : z.zone);

type Errors = Record<string, string>;

// ─── Zone ─────────────────────────────────────────────────────────────────────

export function ZoneModal({
  open,
  onClose,
  zone,
  nextPosition,
}: {
  open: boolean;
  onClose: () => void;
  zone: AdminShippingZone | null;
  nextPosition: number;
}) {
  const create = useCreateZone();
  const update = useUpdateZone();
  const toast = useToast();
  const [name, setName] = useState('');
  const [countries, setCountries] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setName(zone?.zone ?? '');
    setCountries(zone?.countries ?? []);
    setErrors({});
    setFormError(null);
    setTried(false);
  }, [open, zone]);

  const check = (n: string): Errors =>
    !n.trim() ? {zone: 'Name the zone.'} : n.trim().length > L.zoneName ? {zone: `Keep the zone name under ${L.zoneName} characters`} : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError(null);
    setTried(true);
    const errs = check(name);
    setErrors(errs);
    if (Object.keys(errs).length) return document.getElementById('zone-name')?.focus();
    try {
      if (zone) await update.mutateAsync({id: zone.id, zone: name.trim(), countries});
      else await create.mutateAsync({zone: name.trim(), countries, position: nextPosition});
      toast.success(zone ? `${name.trim()} saved` : `${name.trim()} added`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        // Per-country problems arrive as countries.0, countries.3 …; show them under the chips.
        const perCountry = Object.entries(err.fields)
          .filter(([k]) => k.startsWith('countries.'))
          .map(([, v]) => v);
        setErrors({...err.fields, ...(perCountry.length ? {countries: perCountry.join('. ')} : {})});
      } else {
        setFormError(firstProblem(err));
      }
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!pending}
      title={zone ? 'Edit zone' : 'New zone'}
      description="A zone with no countries applies to everywhere else."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="zone-form" pending={pending} pendingLabel="Saving…">
            {zone ? 'Save zone' : 'Add zone'}
          </Button>
        </>
      }>
      <form id="zone-form" onSubmit={e => void submit(e)} noValidate className="form-stack">
        <Field label="Zone name" id="zone-name" error={errors.zone}>
          <input
            id="zone-name"
            value={name}
            autoFocus
            onChange={e => {
              setName(e.target.value);
              if (tried || errors.zone) setErrors(({zone: _drop, ...rest}) => ({...rest, ...check(e.target.value)}));
            }}
            onBlur={() => setErrors(prev => ({...prev, ...check(name)}))}
            {...fieldAria('zone-name', errors.zone)}
          />
        </Field>
        <Field label="Countries" id="zone-countries" error={errors.countries} hint="Leave empty for the catch-all zone">
          <CountryChips
            inputId="zone-countries"
            describedBy={errors.countries ? 'zone-countries-error' : 'zone-countries-hint'}
            invalid={!!errors.countries}
            value={countries}
            onChange={next => {
              setCountries(next);
              setErrors(({countries: _drop, ...rest}) => rest);
            }}
            editable
            disabled={pending}
          />
        </Field>
        {formError && <Notice tone="danger">{formError}</Notice>}
      </form>
    </Modal>
  );
}

// ─── Method ───────────────────────────────────────────────────────────────────

export function MethodModal({
  open,
  onClose,
  zone,
  method,
  symbol,
}: {
  open: boolean;
  onClose: () => void;
  zone: AdminShippingZone | null;
  method: AdminShippingMethod | null;
  /** The store currency's symbol, inside the rate field. */
  symbol: string;
}) {
  const create = useCreateMethod();
  const update = useUpdateMethod();
  const toast = useToast();
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const [rate, setRate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setName(method?.name ?? '');
    setDetail(method?.detail ?? '');
    setRate(method ? String(method.rate) : '');
    setErrors({});
    setFormError(null);
    setTried(false);
  }, [open, method]);

  const check = (v: {name: string; detail: string; rate: string}): Errors => {
    const errs: Errors = {};
    if (!v.name.trim()) errs.name = 'Name the method.';
    else if (v.name.trim().length > L.methodName) errs.name = `Keep the method name under ${L.methodName} characters`;
    if (v.detail.trim().length > L.methodDetail) errs.detail = `Keep this under ${L.methodDetail} characters`;
    const r = Number(v.rate);
    if (v.rate.trim() === '' || !Number.isFinite(r) || r < 0 || r > L.methodRate) errs.rate = 'Enter zero or more. Zero shows as Free.';
    return errs;
  };
  const values = {name, detail, rate};
  const recheck = (next: Partial<typeof values>, key: string) => {
    if (!tried && !errors[key]) return;
    const all = check({...values, ...next});
    setErrors(prev => {
      const {[key]: _drop, ...rest} = prev;
      return all[key] ? {...rest, [key]: all[key]!} : rest;
    });
  };
  const blur = (key: string) => () => {
    const all = check(values);
    setErrors(prev => (all[key] ? {...prev, [key]: all[key]!} : prev));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || !zone) return;
    setFormError(null);
    setTried(true);
    const errs = check(values);
    setErrors(errs);
    const first = ['name', 'detail', 'rate'].find(k => errs[k]);
    if (first) return document.getElementById(`method-${first}`)?.focus();
    const body = {name: name.trim(), detail: detail.trim(), rate: Math.round(Number(rate) * 100) / 100};
    try {
      if (method) await update.mutateAsync({id: method.id, ...body});
      else await create.mutateAsync({zoneId: zone.id, ...body, position: zone.methods.reduce((m, x) => Math.max(m, x.position + 1), 0)});
      toast.success(method ? `${body.name} saved` : `${body.name} added to ${zone.zone}`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setFormError(firstProblem(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!pending}
      size="sm"
      title={method ? 'Edit method' : 'New method'}
      description={zone ? zoneLabel(zone) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="method-form" pending={pending} pendingLabel="Saving…">
            {method ? 'Save method' : 'Add method'}
          </Button>
        </>
      }>
      <form id="method-form" onSubmit={e => void submit(e)} noValidate className="form-stack">
        <Field label="Name" id="method-name" error={errors.name}>
          <input
            id="method-name"
            value={name}
            placeholder="Express"
            autoFocus
            onChange={e => {
              setName(e.target.value);
              recheck({name: e.target.value}, 'name');
            }}
            onBlur={blur('name')}
            {...fieldAria('method-name', errors.name)}
          />
        </Field>
        <Field label="Detail" id="method-detail" error={errors.detail} hint="Delivery estimate shown at checkout">
          <input
            id="method-detail"
            value={detail}
            placeholder="1–2 business days"
            onChange={e => {
              setDetail(e.target.value);
              recheck({detail: e.target.value}, 'detail');
            }}
            onBlur={blur('detail')}
            {...fieldAria('method-detail', errors.detail)}
          />
        </Field>
        <Field label="Rate" id="method-rate" error={errors.rate} hint="0 shows as Free">
          <MoneyInput
            id="method-rate"
            symbol={symbol}
            value={rate}
            onChange={e => {
              setRate(e.target.value);
              recheck({rate: e.target.value}, 'rate');
            }}
            onBlur={blur('rate')}
            {...fieldAria('method-rate', errors.rate)}
          />
        </Field>
        {formError && <Notice tone="danger">{formError}</Notice>}
      </form>
    </Modal>
  );
}
