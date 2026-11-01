import {useQuery} from '@tanstack/react-query';
import {useBlocker, useNavigate} from '@tanstack/react-router';
import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {AdminDiscount, DiscountEligibility, DiscountKind, DiscountScope} from '../../../lib/types/admin/promotions';
import {ApiError} from '../../api';
import {
  type DiscountEditorTab,
  discountProblem,
  discountTaxonomyQuery,
  useCreateDiscount,
  useDeleteDiscount,
  useUpdateDiscount,
} from '../../queries/discounts';
import {Button, Card, Checkbox, Field, Menu, type MenuItem, PageHeader, RadioCards, SegmentedControl, StatusBadge, Tabs, useConfirm, useToast} from '../../ui';
import {CodesPanel} from './CodesPanel';
import {DateTimeField, describedBy, MultiPicker, NumberInput, type PickKind, useCanWrite} from './controls';
import {BackLink} from './EditDiscount';
import {
  ELIGIBILITY_DETAIL,
  ELIGIBILITY_LABEL,
  KIND_LABEL,
  SCOPE_LABEL,
  STATUS_LABEL,
  STATUS_TONES,
  deriveStatus,
  fieldOf,
  formatDateTime,
  formFromDiscount,
  type FieldErrors,
  type NameOf,
  pluralize,
  type PromoForm,
  randomCode,
  snapshot,
  suggestLabel,
  suggestNote,
  summarize,
  toInput,
  validate,
} from './helpers';
import {ReportPanel} from './ReportPanel';
import {SummaryCard} from './SummaryCard';

type Names = Record<PickKind, Record<string, string>>;
const NO_NAMES: Names = {product: {}, category: {}, department: {}, customer: {}};
const SCOPE_TARGET = {
  products: ['productIds', 'product'],
  categories: ['categoryIds', 'category'],
  departments: ['departmentIds', 'department'],
} as const;

/** The discount editor: create, edit and duplicate (VAREL `DiscountEditor`). */
export function DiscountEditor({
  discount,
  initial: initialForm,
  tab = 'settings',
  duplicateOf,
}: {
  /** Absent → create. */
  discount?: AdminDiscount;
  initial: PromoForm;
  tab?: DiscountEditorTab;
  /** Name of the discount this new one copies. */
  duplicateOf?: string;
}) {
  const isNew = !discount;
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const create = useCreateDiscount();
  const update = useUpdateDiscount();
  const del = useDeleteDiscount();
  const saving = create.isPending || update.isPending;

  const [form, setForm] = useState<PromoForm>(initialForm);
  const [initial, setInitial] = useState<PromoForm>(initialForm);
  const [auto, setAuto] = useState(() => ({
    label: isNew && !duplicateOf ? true : !initialForm.label,
    note: isNew && !duplicateOf ? true : !initialForm.note,
  }));
  const [attempted, setAttempted] = useState(false);
  const [server, setServer] = useState<{fields: FieldErrors; at: PromoForm} | null>(null);
  const skip = useRef(false);

  /* Names for chips (with department) and for the summary (plain). */
  const taxonomy = useQuery(discountTaxonomyQuery());
  const [picked, setPicked] = useState<Names>(NO_NAMES);
  const onName = useCallback(
    (kind: PickKind) => (id: string, name: string) => setPicked(p => (p[kind][id] === name ? p : {...p, [kind]: {...p[kind], [id]: name}})),
    []
  );
  const nameHandlers = useMemo(
    () => ({product: onName('product'), category: onName('category'), department: onName('department'), customer: onName('customer')}),
    [onName]
  );
  const {chipNames, plainNames} = useMemo(() => {
    const chip: Names = {product: {...picked.product}, category: {...picked.category}, department: {...picked.department}, customer: {...picked.customer}};
    const plain: Names = {product: {...picked.product}, category: {...picked.category}, department: {...picked.department}, customer: {...picked.customer}};
    for (const d of taxonomy.data ?? []) {
      chip.department[d.id] = plain.department[d.id] = d.name;
      for (const c of d.categories) {
        chip.category[c.id] = `${c.name} · ${d.name}`;
        plain.category[c.id] = c.name;
      }
    }
    return {chipNames: chip, plainNames: plain};
  }, [picked, taxonomy.data]);
  const nameOf: NameOf = useCallback((kind, id) => plainNames[kind][id], [plainNames]);

  /* Auto-suggested label/note follow the rules until edited by hand. */
  const labelSuggestion = suggestLabel(form, nameOf);
  const noteSuggestion = suggestNote(form);
  useEffect(() => {
    setForm(f => {
      const label = auto.label ? labelSuggestion : f.label;
      const note = auto.note ? noteSuggestion : f.note;
      return label === f.label && note === f.note ? f : {...f, label, note};
    });
  }, [auto.label, auto.note, labelSuggestion, noteSuggestion]);

  // A saved label/note that reads exactly as the rules would write it was generated: keep it following the rules,
  // so changing 10% to 15% also changes "10% off". Decided once, after the target names have loaded.
  const decided = useRef(isNew);
  const namesReady =
    !!taxonomy.data &&
    [...initial.productIds.map(id => plainNames.product[id]), ...initial.customerIds.map(id => plainNames.customer[id])].every(Boolean);
  const savedLabelSuggestion = suggestLabel(initial, nameOf);
  const savedNoteSuggestion = suggestNote(initial);
  useEffect(() => {
    if (decided.current || !namesReady) return;
    decided.current = true;
    setAuto(a => ({
      label: a.label || (!!initial.label && initial.label === savedLabelSuggestion),
      note: a.note || (!!initial.note && initial.note === savedNoteSuggestion),
    }));
  }, [namesReady, initial.label, initial.note, savedLabelSuggestion, savedNoteSuggestion]);

  // A fresh form's suggestions aren't edits: compare without them so "new" starts clean.
  const comparable = (f: PromoForm) => (isNew ? snapshot({...f, label: auto.label ? '' : f.label, note: auto.note ? '' : f.note}) : snapshot(f));
  const dirty = comparable(form) !== comparable(initial);

  useBlocker({
    shouldBlockFn: async ({current, next}) => {
      if (!dirty || skip.current || current.pathname === next.pathname) return false;
      const leave = await confirm({
        title: 'Leave without saving?',
        body: 'Your changes to this discount will be lost.',
        confirmLabel: 'Discard changes',
      });
      return !leave;
    },
    enableBeforeUnload: () => dirty && !skip.current,
  });

  const errors = useMemo<FieldErrors>(() => {
    const out: FieldErrors = attempted ? validate(form) : {};
    if (server)
      for (const [path, msg] of Object.entries(server.fields)) {
        const key = fieldOf(path);
        if (!out[key] && JSON.stringify(form[key as keyof PromoForm]) === JSON.stringify(server.at[key as keyof PromoForm])) out[key] = msg;
      }
    return out;
  }, [form, attempted, server]);

  const set = <K extends keyof PromoForm>(key: K, value: PromoForm[K]) => setForm(f => ({...f, [key]: value}));

  function focusFirstError() {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-editor] [aria-invalid="true"]');
      el?.focus();
      el?.scrollIntoView({block: 'center', behavior: 'smooth'});
    });
  }

  function applyServerError(e: unknown) {
    if (e instanceof ApiError && (e.status === 422 || e.status === 409 || e.status === 400)) {
      const fields: FieldErrors = {...e.fields};
      if (e.status === 409 && !Object.keys(fields).length) fields.code = e.message || 'That code is already in use.';
      if (Object.keys(fields).length) {
        setServer({fields, at: form});
        focusFirstError();
        toast.danger(e.message || 'Check the highlighted fields');
        return;
      }
    }
    toast.danger(e instanceof ApiError ? e.message : 'The discount could not be saved');
  }

  function save() {
    if (!canWrite || saving) return;
    setAttempted(true);
    setServer(null);
    const errs = validate(form);
    if (Object.keys(errs).length) {
      toast.danger('Check the highlighted fields');
      focusFirstError();
      return;
    }
    const body = toInput(form);
    if (!discount) {
      create.mutate(body, {
        onSuccess: d => {
          toast.success(`${d.name || d.code || 'Discount'} created`);
          skip.current = true;
          void navigate({to: '/discounts/$id', params: {id: d.id}, search: d.codeType === 'unique' ? {tab: 'codes'} : {}, replace: true});
        },
        onError: applyServerError,
      });
    } else {
      update.mutate(
        {id: discount.id, ...body},
        {
          onSuccess: d => {
            const next = formFromDiscount(d);
            setForm(next);
            setInitial(next);
            setAttempted(false);
            toast.success('Discount saved');
          },
          onError: applyServerError,
        }
      );
    }
  }

  async function remove() {
    if (!discount) return;
    const used = discount.used > 0;
    let deactivated = false;
    const ok = await confirm({
      title: `Delete ${title}?`,
      body: used
        ? 'This discount has been used on orders, so it will be deactivated instead and kept for order history.'
        : 'This removes the discount and any unused codes for good.',
      confirmLabel: used ? 'Deactivate' : 'Delete',
      pendingLabel: used ? 'Deactivating…' : 'Deleting…',
      action: async () => {
        try {
          deactivated = !!(await del.mutateAsync(discount.id))?.deactivated;
        } catch (e) {
          throw new Error(discountProblem(e) || 'The discount could not be deleted');
        }
      },
    });
    if (!ok) return;
    if (deactivated) {
      setForm(f => ({...f, active: false}));
      setInitial(f => ({...f, active: false}));
      toast.success('This discount has been used, so it was deactivated instead of deleted.');
    } else {
      toast.success(`${discount.name || discount.code || 'Discount'} deleted`);
      skip.current = true;
      void navigate({to: '/discounts'});
    }
  }

  const status = deriveStatus({
    ...toInput(form),
    used: discount?.used ?? 0,
    codesTotal: discount?.codesTotal ?? 0,
    codesUsed: discount?.codesUsed ?? 0,
  });
  const summary = summarize(form, nameOf, discount?.codeType === 'unique' ? discount.codesTotal : undefined);
  const title = form.name.trim() || (form.method === 'code' && form.codeType === 'shared' && form.code) || (isNew ? 'New discount' : 'Discount');
  const showCodes = !!discount && discount.codeType === 'unique' && discount.method === 'code';
  const activeTab: DiscountEditorTab = isNew || (tab === 'codes' && !showCodes) ? 'settings' : tab;
  const uniqueLocked = !!discount && discount.codeType === 'unique' && discount.codesTotal > 0;
  const id = (k: string) => `d-${k}`;
  const desc = (k: string, hint?: unknown) => describedBy(id(k), errors[k], hint);

  const saveButton = canWrite && (
    <Button type="submit" form="discount-form" pending={saving} pendingLabel={isNew ? 'Creating…' : 'Saving…'} disabled={!isNew && !dirty} data-testid="save-discount">
      {isNew ? 'Create discount' : 'Save'}
    </Button>
  );

  const moreItems: MenuItem[] = discount
    ? [
        {label: 'Report', icon: 'bar-chart', onSelect: () => void navigate({to: '/discounts/$id', params: {id: discount.id}, search: {tab: 'report'}, replace: true})},
        ...(canWrite
          ? ([
              {label: 'Duplicate', icon: 'copy', onSelect: () => void navigate({to: '/discounts/new', search: {from: discount.id}})},
              'separator',
              {label: discount.used > 0 ? 'Delete (deactivates)…' : 'Delete…', icon: 'trash', danger: true, onSelect: () => void remove()},
            ] satisfies MenuItem[])
          : []),
      ]
    : [];

  const header = (
    <>
      <BackLink />
      <PageHeader
        title={
          <span className="discount-title">
            <span>{title}</span>
            {discount && <StatusBadge tone={STATUS_TONES[status]}>{STATUS_LABEL[status]}</StatusBadge>}
          </span>
        }
        description={
          discount ? (
            <>
              Updated {formatDateTime(discount.updatedAt)} · used {pluralize(discount.used, 'time')}
              {dirty && <span className="discount-unsaved"> · Unsaved changes</span>}
            </>
          ) : duplicateOf ? (
            `Copy of ${duplicateOf}. It starts inactive so you can review it first.`
          ) : (
            'Set the rules, then check the summary on the right.'
          )
        }
        actions={
          <>
            {discount && <Menu label="More discount actions" items={moreItems} />}
            {activeTab === 'settings' && saveButton}
          </>
        }
      />
    </>
  );

  const settings = (
    <form
      id="discount-form"
      noValidate
      className="discount-editor-grid"
      onSubmit={e => {
        e.preventDefault();
        save();
      }}>
      <fieldset disabled={!canWrite} className="discount-editor-main">
        <Card title="Method">
          <div className="form-stack">
            <RadioCards
              legend="Method"
              name={id('method')}
              value={form.method}
              onChange={v => set('method', v)}
              options={[
                {value: 'code', title: 'Discount code', description: 'Customers enter a code in the bag or at checkout.'},
                uniqueLocked
                  ? {value: 'automatic', title: 'Automatic', description: 'Delete the unique codes first to make this automatic.', disabled: true}
                  : {value: 'automatic', title: 'Automatic', description: 'Applies on its own when the bag matches the rules.'},
              ]}
            />
            <Field
              label={form.method === 'automatic' ? 'Name' : 'Internal name'}
              id={id('name')}
              error={errors.name}
              hint={form.method === 'automatic' ? 'Customers see this in the bag, e.g. “Autumn knitwear”.' : 'For your team. Optional for codes.'}>
              <input
                id={id('name')}
                value={form.name}
                maxLength={120}
                onChange={e => set('name', e.target.value)}
                aria-invalid={!!errors.name || undefined}
                aria-describedby={desc('name', true)}
                autoFocus={isNew}
              />
            </Field>
            {form.method === 'code' && (
              <>
                <RadioCards
                  legend="Code type"
                  name={id('codeType')}
                  value={form.codeType}
                  onChange={v => set('codeType', v)}
                  options={[
                    {
                      value: 'shared',
                      title: 'One shared code',
                      description: uniqueLocked ? 'Delete the unique codes first.' : 'Everyone uses the same code.',
                      disabled: uniqueLocked,
                    },
                    {value: 'unique', title: 'Unique codes', description: 'A batch of single-use codes.'},
                  ]}
                />
                {errors.codeType && (
                  <p className="field-error" role="alert">
                    {errors.codeType}
                  </p>
                )}
                {form.codeType === 'shared' ? (
                  <Field label="Code" id={id('code')} error={errors.code} hint="Letters, numbers, dashes. Customers can type it in any case.">
                    <div className="code-input">
                      <input
                        id={id('code')}
                        className="mono"
                        value={form.code}
                        maxLength={40}
                        onChange={e => set('code', e.target.value.toUpperCase().replace(/\s+/g, ''))}
                        aria-invalid={!!errors.code || undefined}
                        aria-describedby={desc('code', true)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <Button variant="secondary" size="sm" icon="refresh" onClick={() => set('code', randomCode(8))}>
                        Generate
                      </Button>
                    </div>
                  </Field>
                ) : (
                  <p className="discount-inset">
                    {discount
                      ? `${pluralize(discount.codesTotal, 'code')} generated, ${discount.codesUsed} used. Manage them in the Codes tab.`
                      : 'Each code works once. Create the discount, then generate a batch in the Codes tab.'}
                  </p>
                )}
              </>
            )}
          </div>
        </Card>

        <Card title="Value">
          <div className="form-stack">
            <SegmentedControl<DiscountKind>
              label="Discount type"
              value={form.kind}
              onChange={kind =>
                setForm(f => ({
                  ...f,
                  kind,
                  value: kind === 'percent' || kind === 'fixed' ? f.value || '10' : '',
                  buyQty: kind === 'bxgy' ? f.buyQty || '2' : f.buyQty,
                  getQty: kind === 'bxgy' ? f.getQty || '1' : f.getQty,
                  getPercent: kind === 'bxgy' ? f.getPercent || '100' : f.getPercent,
                }))
              }
              options={(Object.keys(KIND_LABEL) as DiscountKind[]).map(k => ({value: k, label: KIND_LABEL[k]}))}
            />
            {form.kind === 'percent' && (
              <div className="grid-2">
                <Field label="Percentage off" id={id('value')} error={errors.value}>
                  <NumberInput id={id('value')} value={form.value} suffix="%" invalid={!!errors.value} describedBy={desc('value')} onChange={v => set('value', v)} />
                </Field>
                <Field label="Maximum discount" id={id('maxAmount')} error={errors.maxAmount} hint="Optional cap, e.g. up to $50.">
                  <NumberInput
                    id={id('maxAmount')}
                    value={form.maxAmount}
                    prefix="$"
                    placeholder="No cap"
                    invalid={!!errors.maxAmount}
                    describedBy={desc('maxAmount', true)}
                    onChange={v => set('maxAmount', v)}
                  />
                </Field>
              </div>
            )}
            {form.kind === 'fixed' && (
              <div className="grid-2">
                <Field label="Amount off" id={id('value')} error={errors.value} hint="Split across the qualifying items.">
                  <NumberInput id={id('value')} value={form.value} prefix="$" invalid={!!errors.value} describedBy={desc('value', true)} onChange={v => set('value', v)} />
                </Field>
              </div>
            )}
            {form.kind === 'shipping' && (
              <p className="muted">Removes the shipping charge for the selected method. Use Applies to for free shipping on some items only.</p>
            )}
            {form.kind === 'bxgy' && (
              <>
                <div className="grid-3 bxgy-grid">
                  <Field label="Customer buys" id={id('buyQty')} error={errors.buyQty}>
                    <NumberInput
                      id={id('buyQty')}
                      value={form.buyQty}
                      decimals={false}
                      suffix="items"
                      invalid={!!errors.buyQty}
                      describedBy={desc('buyQty')}
                      onChange={v => set('buyQty', v)}
                    />
                  </Field>
                  <Field label="Gets" id={id('getQty')} error={errors.getQty}>
                    <NumberInput
                      id={id('getQty')}
                      value={form.getQty}
                      decimals={false}
                      suffix="items"
                      invalid={!!errors.getQty}
                      describedBy={desc('getQty')}
                      onChange={v => set('getQty', v)}
                    />
                  </Field>
                  <Field label="At" id={id('getPercent')} error={errors.getPercent}>
                    <NumberInput
                      id={id('getPercent')}
                      value={form.getPercent}
                      decimals={false}
                      suffix="% off"
                      invalid={!!errors.getPercent}
                      describedBy={desc('getPercent')}
                      onChange={v => set('getPercent', v)}
                    />
                  </Field>
                </div>
                <div className="quick-set">
                  <span>Quick set:</span>
                  {[
                    ['100', 'Free'],
                    ['50', 'Half price'],
                  ].map(([v, l]) => (
                    <button key={v} type="button" className="filter-toggle" aria-pressed={form.getPercent === v} onClick={() => set('getPercent', v!)}>
                      {l}
                    </button>
                  ))}
                  <span>Both come from the items in Applies to; the cheapest in each group get the discount.</span>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card title="Applies to">
          <div className="form-stack">
            <SegmentedControl<DiscountScope>
              label="Applies to"
              value={form.scope}
              onChange={v => set('scope', v)}
              options={(Object.keys(SCOPE_LABEL) as DiscountScope[]).map(k => ({value: k, label: SCOPE_LABEL[k]}))}
            />
            {form.scope === 'order' ? (
              <p className="muted">Every item in the bag counts towards the discount.</p>
            ) : (
              (() => {
                const [key, kind] = SCOPE_TARGET[form.scope];
                return (
                  <Field label={SCOPE_LABEL[form.scope]} id={id(key)} error={errors[key]}>
                    <MultiPicker
                      key={kind}
                      id={id(key)}
                      kind={kind}
                      value={form[key]}
                      onChange={ids => set(key, ids)}
                      names={chipNames[kind]}
                      onName={nameHandlers[kind]}
                      invalid={!!errors[key]}
                      describedBy={desc(key)}
                      disabled={!canWrite}
                    />
                  </Field>
                );
              })()
            )}
          </div>
        </Card>

        <Card title="Requirements" description="Counted on the items in Applies to.">
          <div className="grid-2">
            <Field label="Minimum spend" id={id('minimum')} error={errors.minimum} hint="Leave empty for no minimum.">
              <NumberInput
                id={id('minimum')}
                value={form.minimum}
                prefix="$"
                placeholder="0"
                invalid={!!errors.minimum}
                describedBy={desc('minimum', true)}
                onChange={v => set('minimum', v)}
              />
            </Field>
            <Field label="Minimum quantity" id={id('minimumQty')} error={errors.minimumQty} hint="Items in the bag. Leave empty for none.">
              <NumberInput
                id={id('minimumQty')}
                value={form.minimumQty}
                decimals={false}
                placeholder="None"
                invalid={!!errors.minimumQty}
                describedBy={desc('minimumQty', true)}
                onChange={v => set('minimumQty', v)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Eligibility">
          <div className="form-stack">
            <RadioCards<DiscountEligibility>
              legend="Who can use it"
              name={id('eligibility')}
              value={form.eligibility}
              onChange={v => set('eligibility', v)}
              options={(Object.keys(ELIGIBILITY_LABEL) as DiscountEligibility[]).map(k => ({
                value: k,
                title: ELIGIBILITY_LABEL[k],
                description: ELIGIBILITY_DETAIL[k],
              }))}
            />
            {form.eligibility === 'customers' && (
              <Field label="Customers" id={id('customerIds')} error={errors.customerIds}>
                <MultiPicker
                  id={id('customerIds')}
                  kind="customer"
                  value={form.customerIds}
                  onChange={ids => set('customerIds', ids)}
                  names={chipNames.customer}
                  onName={nameHandlers.customer}
                  invalid={!!errors.customerIds}
                  describedBy={desc('customerIds')}
                  disabled={!canWrite}
                />
              </Field>
            )}
          </div>
        </Card>

        <Card title="Limits">
          <div className="grid-2">
            <Field label="Total uses" id={id('usageLimit')} error={errors.usageLimit} hint="Across all customers. Empty for no limit.">
              <NumberInput
                id={id('usageLimit')}
                value={form.usageLimit}
                decimals={false}
                placeholder="No limit"
                invalid={!!errors.usageLimit}
                describedBy={desc('usageLimit', true)}
                onChange={v => set('usageLimit', v)}
              />
            </Field>
            <Field label="Uses per customer" id={id('perCustomerLimit')} error={errors.perCustomerLimit} hint="Matched by account or email.">
              <NumberInput
                id={id('perCustomerLimit')}
                value={form.perCustomerLimit}
                decimals={false}
                placeholder="No limit"
                invalid={!!errors.perCustomerLimit}
                describedBy={desc('perCustomerLimit', true)}
                onChange={v => set('perCustomerLimit', v)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Combinations">
          <div className="grid-2">
            <Checkbox
              label="Combines with other discounts"
              description={
                form.combinable ? 'Can apply alongside other combinable discounts.' : 'Applies alone. When another offer saves the customer more, that one wins.'
              }
              checked={form.combinable}
              disabled={!canWrite}
              onChange={v => set('combinable', v)}
            />
            <Field
              label="Priority"
              id={id('priority')}
              error={errors.priority}
              hint="Higher applies first. On a tie, codes go before automatic discounts, then older first.">
              <NumberInput
                id={id('priority')}
                value={form.priority}
                decimals={false}
                negative
                invalid={!!errors.priority}
                describedBy={desc('priority', true)}
                onChange={v => set('priority', v)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Active dates">
          <div className="form-stack">
            <Checkbox
              label="Active"
              description={form.active ? 'On, within the dates below.' : 'Switched off. Customers cannot get it.'}
              checked={form.active}
              disabled={!canWrite}
              onChange={v => set('active', v)}
            />
            <div className="grid-2">
              <Field label="Starts" id={id('startsAt')} error={errors.startsAt}>
                <DateTimeField
                  id={id('startsAt')}
                  value={form.startsAt}
                  onChange={v => set('startsAt', v)}
                  empty="Starts now"
                  defaultTime="00:00"
                  invalid={!!errors.startsAt}
                  describedBy={desc('startsAt')}
                  disabled={!canWrite}
                />
              </Field>
              <Field label="Ends" id={id('endsAt')} error={errors.endsAt} hint="Optional.">
                <DateTimeField
                  id={id('endsAt')}
                  value={form.endsAt}
                  onChange={v => set('endsAt', v)}
                  empty="No end date"
                  defaultTime="23:59"
                  invalid={!!errors.endsAt}
                  describedBy={desc('endsAt', true)}
                  disabled={!canWrite}
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Customer-facing text" description="Shown in the bag, at checkout and on the order.">
          <div className="grid-2">
            <Field
              label="Label"
              id={id('label')}
              error={errors.label}
              hint={<SuggestHint auto={auto.label} suggestion={labelSuggestion} onUse={() => setAuto(a => ({...a, label: true}))} />}>
              <input
                id={id('label')}
                value={form.label}
                maxLength={120}
                onChange={e => {
                  setAuto(a => ({...a, label: false}));
                  set('label', e.target.value);
                }}
                aria-invalid={!!errors.label || undefined}
                aria-describedby={desc('label', true)}
              />
            </Field>
            <Field
              label="Note"
              id={id('note')}
              error={errors.note}
              hint={<SuggestHint auto={auto.note} suggestion={noteSuggestion} onUse={() => setAuto(a => ({...a, note: true}))} />}>
              <input
                id={id('note')}
                value={form.note}
                maxLength={300}
                placeholder="Conditions, e.g. Minimum spend $100"
                onChange={e => {
                  setAuto(a => ({...a, note: false}));
                  set('note', e.target.value);
                }}
                aria-invalid={!!errors.note || undefined}
                aria-describedby={desc('note', true)}
              />
            </Field>
          </div>
        </Card>
      </fieldset>

      <div className="discount-editor-side">
        <SummaryCard form={form} summary={summary} status={status} discount={discount} />
        {canWrite && (
          <div className="form-actions">
            {!isNew && dirty && (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setForm(initial);
                  setServer(null);
                  setAttempted(false);
                }}>
                Discard changes
              </Button>
            )}
            {saveButton}
          </div>
        )}
      </div>
    </form>
  );

  return (
    <div className="app-page discount-screen" data-editor>
      {header}
      {discount ? (
        <Tabs<DiscountEditorTab>
          label="Discount sections"
          items={[
            {value: 'settings', label: 'Settings'},
            ...(showCodes ? [{value: 'codes' as const, label: `Codes (${discount.codesTotal.toLocaleString('en-US')})`}] : []),
            {value: 'report', label: 'Report'},
          ]}
          value={activeTab}
          onChange={t => void navigate({to: '/discounts/$id', params: {id: discount.id}, search: t === 'settings' ? {} : {tab: t}, replace: true})}>
          {activeTab === 'codes' && <CodesPanel discount={discount} />}
          {activeTab === 'report' && <ReportPanel id={discount.id} />}
          <div hidden={activeTab !== 'settings'}>{settings}</div>
        </Tabs>
      ) : (
        settings
      )}
    </div>
  );
}

function SuggestHint({auto, suggestion, onUse}: {auto: boolean; suggestion: string; onUse: () => void}): ReactNode {
  if (auto) return <>Suggested from the rules. Edit to write your own.</>;
  if (!suggestion) return null;
  return (
    <>
      Suggestion: {suggestion}.{' '}
      <button type="button" className="link-button" onClick={onUse}>
        Use it
      </button>
    </>
  );
}
