/* The product editor (VAREL `ProductEditor.tsx`): one form for a new or an existing product. Main column: General,
   Media, Pricing, Inventory, Variants (WP-18), Shipping, Search listing; aside: Status, Organisation, Merchandising.
   Errors show after the first save attempt (then live) or when a field loses focus; server field errors stay on
   their field until its value changes. Leaving with unsaved changes asks first. */
import {useQuery} from '@tanstack/react-query';
import {Link, useBlocker, useNavigate} from '@tanstack/react-router';
import {type FormEvent, useMemo, useRef, useState} from 'react';

import type {AdminProduct} from '../../../lib/types/admin/catalog';
import {ApiError} from '../../api';
import {departmentsQuery} from '../../queries/catalog';
import {
  productCurrencyQuery,
  productCurrencySymbol,
  useCreateProduct,
  useDeleteProduct,
  useDuplicateProduct,
  useUpdateProduct,
} from '../../queries/products';
import {when} from '../../shared';
import {
  Button,
  buttonClass,
  Card,
  Field,
  Icon,
  ImageUploader,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  RichTextEditor,
  Select,
  TagInput,
  useConfirm,
  useToast,
} from '../../ui';
import {
  baseSkuFromName,
  emptyForm,
  type FieldErrors,
  formFromProduct,
  LIMITS,
  type ProductForm,
  slugFromName,
  snapshot,
  toInput,
  validate,
  valueAt,
} from './form';
import {ProductStatusBadge} from './ProductActions';
import {MerchandisingPanel, SeoPanel} from './ProductExtrasPanels';
import {aria, InventoryPanel, PricingPanel, ShippingPanel} from './ProductSections';
import {VariantsSection} from './VariantsSection';

const STATUS_OPTIONS = [
  {value: 'draft', label: 'Draft'},
  {value: 'published', label: 'Published'},
  {value: 'archived', label: 'Archived'},
];

const STATUS_LINE = {
  published: 'Visible in the shop, search and product pages.',
  draft: 'Hidden from the store until published.',
  archived: 'Hidden from the store and kept for order history.',
} as const;

const messageOf = (e: unknown, fallback = 'Try again.') => (e instanceof Error && e.message ? e.message : fallback);
const ordersText = (n: number) => (n > 100 ? '100+ orders' : `${n} ${n === 1 ? 'order' : 'orders'}`);

export function ProductEditor({product}: {product?: AdminProduct}) {
  const isNew = !product;
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const departments = useQuery(departmentsQuery);
  const currency = useQuery(productCurrencyQuery);
  const symbol = productCurrencySymbol(currency.data);

  const [form, setForm] = useState<ProductForm>(() => (product ? formFromProduct(product) : emptyForm()));
  const [initial, setInitial] = useState<ProductForm>(form);
  const [server, setServer] = useState<{fields: FieldErrors; at: ProductForm} | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [blurred, setBlurred] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState({id: false, sku: false});
  // Bumped on discard so the variants editor re-reads its options from the reset rows.
  const [variantsKey, setVariantsKey] = useState(0);
  const skipBlock = useRef(false);

  const create = useCreateProduct();
  const update = useUpdateProduct(product?.id ?? '');
  const del = useDeleteProduct();
  const dup = useDuplicateProduct();
  const saving = create.isPending || update.isPending;

  const initialSnap = useMemo(() => snapshot(initial), [initial]);
  const dirty = snapshot(form) !== initialSnap;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useBlocker({
    shouldBlockFn: async () => {
      if (!dirtyRef.current || skipBlock.current) return false;
      const leave = await confirm({
        title: 'Leave without saving?',
        body: 'Your changes to this product will be lost.',
        confirmLabel: 'Discard changes',
        tone: 'danger',
      });
      return !leave;
    },
    enableBeforeUnload: () => dirtyRef.current && !skipBlock.current,
  });

  // Client errors re-validate live once the user has tried to save (or left the field); server errors stay on a
  // field until that field's value changes.
  const errors = useMemo<FieldErrors>(() => {
    const all = validate(form);
    const out: FieldErrors = {};
    for (const [path, msg] of Object.entries(all)) if (attempted || blurred.has(path)) out[path] = msg;
    if (server)
      for (const [path, msg] of Object.entries(server.fields))
        if (!out[path] && valueAt(form, path) === valueAt(server.at, path)) out[path] = msg;
    return out;
  }, [form, attempted, blurred, server]);

  const onBlur = (path: string) => setBlurred(prev => (prev.has(path) ? prev : new Set(prev).add(path)));
  const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) => setForm(f => ({...f, [key]: value}));

  function setName(name: string) {
    setForm(f => ({
      ...f,
      name,
      ...(isNew && !touched.id ? {id: slugFromName(name)} : {}),
      ...(isNew && !touched.sku ? {sku: baseSkuFromName(name)} : {}),
    }));
  }

  const dept = departments.data?.find(d => d.name === form.dept);
  const uploading = form.images.some(i => i.progress !== undefined);

  function focusFirstError() {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('.screen-product-editor [aria-invalid="true"]');
      el?.focus({preventScroll: true});
      el?.scrollIntoView({block: 'center', behavior: 'smooth'});
    });
  }

  function applyServerError(e: unknown) {
    if (e instanceof ApiError && (e.status === 422 || e.status === 409)) {
      const fields: FieldErrors = {...e.fields};
      if (Object.keys(fields).length) {
        setServer({fields, at: form});
        setStatus(e.message || 'Check the highlighted fields');
        focusFirstError();
        return;
      }
    }
    if (e instanceof ApiError && e.status === 413) {
      setStatus('The product could not be saved: it is too large to send. Shorten the description or use fewer variants.');
      return;
    }
    setStatus(`The product could not be saved: ${messageOf(e)}`);
  }

  function save() {
    setAttempted(true);
    setServer(null);
    const errs = validate(form);
    if (Object.keys(errs).length) {
      setStatus(errs.images === 'Wait for uploads to finish' ? 'Wait for uploads to finish' : 'Check the highlighted fields');
      focusFirstError();
      return;
    }
    setStatus(null);
    if (isNew) {
      create.mutate(toInput(form, {includeId: true}), {
        onSuccess: p => {
          toast.success(`${p.name} created`);
          skipBlock.current = true;
          void navigate({to: '/products/$id', params: {id: p.id}, replace: true});
        },
        onError: applyServerError,
      });
    } else {
      update.mutate(toInput(form, {includeId: false}), {
        onSuccess: p => {
          const next = formFromProduct(p);
          setForm(next);
          setInitial(next);
          setAttempted(false);
          setBlurred(new Set());
          setServer(null);
          setVariantsKey(k => k + 1);
          toast.success('Product saved');
        },
        onError: applyServerError,
      });
    }
  }

  async function archive() {
    if (!product) return;
    const done = await confirm({
      title: 'Archive this product?',
      body: 'It disappears from the shop, search and wishlists. Orders keep their history. You can publish it again later.',
      confirmLabel: 'Archive',
      pendingLabel: 'Archiving…',
      tone: 'primary',
      action: () => update.mutateAsync({status: 'archived'}),
    });
    if (!done) return;
    setForm(f => ({...f, status: 'archived'}));
    setInitial(f => ({...f, status: 'archived'}));
    toast.success('Product archived. It no longer appears in the store.');
  }

  async function remove() {
    if (!product) return;
    const ordered = product.orderCount > 0;
    const box: {archived?: boolean} = {};
    const done = await confirm({
      title: 'Delete this product?',
      body: ordered
        ? 'This product appears in orders, so it will be archived instead of deleted.'
        : 'This permanently removes the product, its images and variants. It cannot be undone.',
      confirmLabel: ordered ? 'Archive' : 'Delete',
      pendingLabel: ordered ? 'Archiving…' : 'Deleting…',
      tone: 'danger',
      action: async () => {
        box.archived = (await del.mutateAsync(product.id)).archived;
      },
    });
    if (!done) return;
    if (box.archived) {
      setForm(f => ({...f, status: 'archived'}));
      setInitial(f => ({...f, status: 'archived'}));
      toast.info('This product has orders, so it was archived instead of deleted.');
    } else {
      toast.success(`${product.name} deleted`);
      skipBlock.current = true;
      void navigate({to: '/products'});
    }
  }

  function duplicate() {
    if (!product) return;
    dup.mutate(product.id, {
      onSuccess: p => {
        toast.success(`Draft copy created: ${p.name}`);
        void navigate({to: '/products/$id', params: {id: p.id}});
      },
      onError: e => toast.danger(`The product could not be duplicated: ${messageOf(e)}`),
    });
  }

  function discard() {
    setForm(initial);
    setServer(null);
    setStatus(null);
    setAttempted(false);
    setBlurred(new Set());
    setVariantsKey(k => k + 1);
  }

  const mediaError = errors.images ?? Object.entries(errors).find(([k]) => k.startsWith('images.'))?.[1];
  const published = product?.status === 'published' && form.status === 'published';
  const busy = saving || del.isPending;

  const saveButton = (
    <Button type="submit" size="sm" pending={saving} pendingLabel={isNew ? 'Creating…' : 'Saving…'} disabled={uploading || (!isNew && !dirty) || del.isPending}>
      {isNew ? 'Create product' : 'Save'}
    </Button>
  );

  const moreItems: MenuItem[] = product
    ? [
        {label: 'Duplicate as draft', icon: 'copy', onSelect: duplicate, disabled: dup.isPending},
        ...(form.status !== 'archived' ? [{label: 'Archive', icon: 'inbox' as const, onSelect: () => void archive()}] : []),
        'separator',
        {label: 'Delete…', icon: 'trash', danger: true, onSelect: () => void remove()},
      ]
    : [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) save();
  };

  const slugHint = isNew ? 'Generated from the name. It cannot change after the product is created.' : 'The slug is fixed after creation.';
  const shortHint = 'One line under the name on the product page.';
  const descHint = 'Shown on the product page. Use headings, lists and links to structure longer details.';
  const tagsHint = 'Press Enter or comma to add.';

  return (
    <form className="app-page screen-product-editor" noValidate onSubmit={onSubmit}>
      <div className="editor-back">
        <Link to="/products" className={buttonClass({variant: 'link', size: 'sm'})}>
          <Icon name="arrow-left" size={16} />
          Products
        </Link>
      </div>
      <PageHeader
        title={
          <span className="editor-title">
            {form.name.trim() || (isNew ? 'New product' : product.name)}
            {product && <ProductStatusBadge status={form.status} />}
          </span>
        }
        description={
          product ? (
            <>
              Updated {when(product.updatedAt)}
              {product.orderCount > 0 && ` · in ${ordersText(product.orderCount)}`}
              {dirty && <span className="text-notice"> · Unsaved changes</span>}
            </>
          ) : (
            'Saved as a draft unless you set the status to published.'
          )
        }
        actions={
          <>
            {published && (
              <a className={buttonClass({variant: 'ghost', size: 'sm'})} href={`/product/${encodeURIComponent(product.id)}/`} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={16} />
                View on store
              </a>
            )}
            {product && <Menu label="More product actions" items={moreItems} disabled={busy} />}
            {saveButton}
          </>
        }
      />

      {status && (
        <Notice tone="danger">
          <span role="alert">{status}</span>
        </Notice>
      )}

      <div className="editor-grid">
        <div className="editor-main">
          <Card title="General">
            <div className="grid-2 editor-fields">
              <div className="span-2">
                <Field id="p-name" label="Name" error={errors.name}>
                  <input
                    id="p-name"
                    value={form.name}
                    maxLength={LIMITS.name + 20}
                    autoComplete="off"
                    disabled={busy}
                    autoFocus={isNew}
                    onChange={e => setName(e.target.value)}
                    onBlur={() => onBlur('name')}
                    {...aria('p-name', errors.name)}
                  />
                </Field>
              </div>
              <Field id="p-slug" label="Slug" error={errors.id} hint={slugHint}>
                <span className="input-prefix" data-invalid={errors.id ? '' : undefined} data-readonly={isNew ? undefined : ''}>
                  <span className="input-prefix-text" aria-hidden="true">
                    /product/
                  </span>
                  <input
                    id="p-slug"
                    value={form.id}
                    readOnly={!isNew}
                    disabled={busy}
                    autoComplete="off"
                    maxLength={LIMITS.slug}
                    onChange={e => {
                      setTouched(t => ({...t, id: true}));
                      set('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                    }}
                    onBlur={() => onBlur('id')}
                    {...aria('p-slug', errors.id, slugHint)}
                  />
                </span>
              </Field>
              <Field id="p-brand" label="Brand" error={errors.brand}>
                <input
                  id="p-brand"
                  value={form.brand}
                  disabled={busy}
                  autoComplete="off"
                  onChange={e => set('brand', e.target.value)}
                  onBlur={() => onBlur('brand')}
                  {...aria('p-brand', errors.brand)}
                />
              </Field>
              <div className="span-2">
                <Field id="p-short" label="Short description" error={errors.short} hint={shortHint}>
                  <input
                    id="p-short"
                    value={form.short}
                    disabled={busy}
                    onChange={e => set('short', e.target.value)}
                    onBlur={() => onBlur('short')}
                    {...aria('p-short', errors.short, shortHint)}
                  />
                </Field>
              </div>
              <div className="span-2">
                <Field id="p-desc" label="Description" error={errors.description} hint={descHint}>
                  <RichTextEditor
                    id="p-desc"
                    label="Description"
                    size="md"
                    value={form.description}
                    disabled={busy}
                    invalid={Boolean(errors.description)}
                    describedBy={errors.description ? 'p-desc-error' : 'p-desc-hint'}
                    placeholder="What it is, how it is made, how it fits…"
                    onChange={html => set('description', html)}
                  />
                </Field>
              </div>
              <Field id="p-material" label="Material" error={errors.material}>
                <input
                  id="p-material"
                  value={form.material}
                  placeholder="100% linen"
                  disabled={busy}
                  onChange={e => set('material', e.target.value)}
                  onBlur={() => onBlur('material')}
                  {...aria('p-material', errors.material)}
                />
              </Field>
              <Field id="p-care" label="Care" error={errors.care}>
                <input
                  id="p-care"
                  value={form.care}
                  placeholder="Cold wash, dry flat"
                  disabled={busy}
                  onChange={e => set('care', e.target.value)}
                  onBlur={() => onBlur('care')}
                  {...aria('p-care', errors.care)}
                />
              </Field>
              <div className="span-2">
                <Field id="p-tags" label="Tags" error={errors.tags} hint={tagsHint}>
                  <TagInput
                    id="p-tags"
                    value={form.tags}
                    disabled={busy}
                    invalid={Boolean(errors.tags)}
                    describedBy={errors.tags ? 'p-tags-error' : 'p-tags-hint'}
                    placeholder="linen, summer, new"
                    onChange={tags => set('tags', tags)}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card title="Media" description="The first image is the primary image on the storefront. Drag to reorder.">
            <ImageUploader
              label="Product images"
              images={form.images}
              disabled={busy}
              error={mediaError}
              onChange={fn => setForm(f => ({...f, images: fn(f.images)}))}
            />
          </Card>

          <PricingPanel
            form={form}
            set={set}
            errors={errors}
            symbol={symbol}
            disabled={busy}
            onBlur={onBlur}
            onApplyToVariants={() => setForm(f => ({...f, variants: f.variants.map(v => ({...v, price: ''}))}))}
          />

          <InventoryPanel
            form={form}
            set={set}
            errors={errors}
            disabled={busy}
            onBlur={onBlur}
            onSkuChange={sku => {
              setTouched(t => ({...t, sku: true}));
              set('sku', sku);
            }}
          />

          <VariantsSection
            key={variantsKey}
            options={form.options}
            variants={form.variants}
            onChange={fn => setForm(f => ({...f, ...fn({options: f.options, variants: f.variants})}))}
            baseSku={form.sku}
            productPrice={form.price}
            digital={form.type === 'digital'}
            errors={errors}
            disabled={busy}
            currencySymbol={symbol}
          />

          <ShippingPanel form={form} set={set} errors={errors} disabled={busy} onBlur={onBlur} typeLocked={!isNew && product.orderCount > 0} />

          <SeoPanel form={form} set={set} errors={errors} disabled={busy} onBlur={onBlur} />
        </div>

        <div className="editor-aside">
          <Card title="Status">
            <Field id="p-status" label="Visibility" error={errors.status}>
              <Select
                id="p-status"
                value={form.status}
                disabled={busy}
                options={STATUS_OPTIONS}
                onChange={e => set('status', e.target.value as ProductForm['status'])}
              />
            </Field>
            <p className="editor-note">{STATUS_LINE[form.status]}</p>
          </Card>

          <Card title="Organisation">
            <div className="editor-fields">
              <Field id="p-dept" label="Department" error={errors.dept}>
                <Select
                  id="p-dept"
                  value={form.dept}
                  disabled={busy}
                  options={[
                    {value: '', label: departments.isPending ? 'Loading…' : 'Choose a department'},
                    ...(departments.data ?? []).map(d => ({value: d.name, label: d.name})),
                    // Keep the saved name visible even when it is not (yet) in the list.
                    ...(form.dept && !departments.data?.some(d => d.name === form.dept) ? [{value: form.dept, label: form.dept}] : []),
                  ]}
                  onChange={e => {
                    const name = e.target.value;
                    const next = departments.data?.find(d => d.name === name);
                    setForm(f => ({...f, dept: name, category: next?.categories.some(c => c.name === f.category) ? f.category : ''}));
                  }}
                  onBlur={() => onBlur('dept')}
                  {...aria('p-dept', errors.dept)}
                />
              </Field>
              <Field id="p-cat" label="Category" error={errors.category}>
                <Select
                  id="p-cat"
                  value={form.category}
                  disabled={!dept || busy}
                  options={[
                    {value: '', label: dept ? 'Choose a category' : 'Choose a department first'},
                    ...(dept?.categories ?? []).map(c => ({value: c.name, label: c.name})),
                    ...(form.category && dept && !dept.categories.some(c => c.name === form.category) ? [{value: form.category, label: form.category}] : []),
                  ]}
                  onChange={e => set('category', e.target.value)}
                  onBlur={() => onBlur('category')}
                  {...aria('p-cat', errors.category)}
                />
              </Field>
              {departments.isError && <p className="field-error">Departments could not be loaded. {messageOf(departments.error)}</p>}
            </div>
          </Card>

          <MerchandisingPanel form={form} set={set} disabled={busy} />

          <div className="editor-aside-actions">
            {!isNew && dirty && (
              <Button variant="ghost" size="sm" disabled={saving} onClick={discard}>
                Discard changes
              </Button>
            )}
            {saveButton}
          </div>
        </div>
      </div>
    </form>
  );
}
