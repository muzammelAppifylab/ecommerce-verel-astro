import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useBlocker, useNavigate, useParams} from '@tanstack/react-router';
import {type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState} from 'react';

import {money, slugify} from '../../../lib/format';
import {toPlainText} from '../../../lib/rich-text';
import type {AdminProductRow} from '../../../lib/types/admin/catalog';
import type {AdminCollection} from '../../../lib/types/admin/merchandising';
import {ApiError} from '../../api';
import {
  collectionDeleted,
  collectionProductPickerQuery,
  collectionQuery,
  collectionSaved,
  deleteCollection,
  saveCollection,
} from '../../queries/collections';
import {when} from '../../shared';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  IMAGE_TYPES,
  Icon,
  IconButton,
  LoadingBlock,
  PageHeader,
  ProgressBar,
  RichTextEditor,
  SearchInput,
  SortableList,
  StatusBadge,
  Switch,
  buttonClass,
  imageFileProblem,
  prepareImage,
  uploadImage,
  useConfirm,
  useToast,
} from '../../ui';
import {
  type CollectionForm,
  EMPTY_COLLECTION_FORM,
  SEO_DESCRIPTION_LIMIT,
  SEO_TITLE_LIMIT,
  changedFields,
  collectionFormErrors,
  formOfCollection,
  inputOfCollection,
  sameValue,
} from './editor-form';
import {ProductStatusBadge, Thumb, productCount, useMerchReadOnly} from './shared';

/** `/dashboard/collections/$id` (`new` creates one). VAREL `CollectionEditor.tsx`. */
export function CollectionEditor() {
  const {id = 'new'} = useParams({strict: false}) as {id?: string};
  const isNew = id === 'new';
  const query = useQuery({...collectionQuery(id), enabled: !isNew});

  if (!isNew && query.isPending) {
    return (
      <div className="app-page screen-collections" aria-busy="true">
        <LoadingBlock rows={4} />
      </div>
    );
  }
  if (!isNew && query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="app-page screen-collections">
        <BackLink />
        <PageHeader title={missing ? 'Collection not found' : 'Collection'} />
        <div className="merch-error">
          <ErrorNote
            title={missing ? 'This collection does not exist or was deleted' : 'This collection could not be loaded'}
            error={query.error}
          />
          {!missing && (
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => void query.refetch()} pending={query.isFetching} pendingLabel="Retrying…">
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }
  return <Editor key={query.data?.id ?? 'new'} collection={isNew ? undefined : query.data} />;
}

function BackLink() {
  return (
    <Link to="/collections" className="merch-back">
      <Icon name="arrow-left" size={14} />
      Collections
    </Link>
  );
}

function Editor({collection}: {collection?: AdminCollection}) {
  const isNew = !collection;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const readOnly = useMerchReadOnly();
  const initial = useMemo(() => (collection ? formOfCollection(collection) : EMPTY_COLLECTION_FORM), [collection]);
  const [form, setForm] = useState<CollectionForm>(initial);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [attempted, setAttempted] = useState(false);
  const [server, setServer] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState<{progress: number; preview: string} | null>(null);
  const [status, setStatus] = useState('');
  const skipBlock = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof saveCollection>[1]) => saveCollection(collection?.id, body),
    onSuccess: c => collectionSaved(queryClient, c),
  });

  const dirty = !sameValue(inputOfCollection(form), inputOfCollection(initial));
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !skipBlock.current,
    enableBeforeUnload: () => dirty && !skipBlock.current,
    withResolver: true,
  });
  useEffect(() => {
    if (blocker.status !== 'blocked') return;
    void confirm({
      title: 'Leave without saving?',
      body: 'Your changes to this collection will be lost.',
      confirmLabel: 'Discard changes',
    }).then(ok => (ok ? blocker.proceed?.() : blocker.reset?.()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.status]);

  const set = <K extends keyof CollectionForm>(key: K, value: CollectionForm[K]) => {
    setForm(f => ({...f, [key]: value}));
    const serverKey = key === 'products' ? 'productIds' : key;
    if (server[serverKey]) setServer(({[serverKey]: _drop, ...rest}) => rest);
  };

  const errors = collectionFormErrors(form, attempted, server);
  const invalid = Object.values(errors).some(Boolean) || !form.title.trim();

  const onTitle = (title: string) => {
    setForm(f => ({...f, title, ...(!slugTouched ? {slug: slugify(title)} : {})}));
    if (server.title) setServer(({title: _drop, ...rest}) => rest);
  };

  async function pickImage(file: File) {
    const problem = imageFileProblem(file);
    if (problem) return toast.danger(problem);
    try {
      const prepared = await prepareImage(file);
      setUpload({progress: 0, preview: prepared.preview});
      const res = await uploadImage(file, p => setUpload(u => (u ? {...u, progress: p} : u)), prepared);
      set('image', {src: res.url, credit: '', creditHref: ''});
    } catch (error) {
      toast.danger(error instanceof Error && error.message ? error.message : `${file.name} could not be uploaded`);
    } finally {
      setUpload(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    setStatus('');
    if (invalid || upload) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.screen-collections [aria-invalid="true"]')?.focus());
      return;
    }
    const next = inputOfCollection(form);
    const body = isNew ? next : changedFields(next, inputOfCollection(initial));
    save.mutate(body, {
      onSuccess: c => {
        toast.success(isNew ? `${c.title} created` : 'Collection saved');
        if (isNew) {
          skipBlock.current = true;
          void navigate({to: '/collections/$id', params: {id: c.id}, replace: true});
        }
      },
      onError: error => {
        if (error instanceof ApiError && Object.keys(error.fields).length) {
          setServer(error.fields);
          requestAnimationFrame(() => document.querySelector<HTMLElement>('.screen-collections [aria-invalid="true"]')?.focus());
        }
        setStatus(error.message);
      },
    });
  }

  const remove = async () => {
    if (!collection) return;
    const done = await confirm({
      title: `Delete ${collection.title}?`,
      body: 'The collection page stops working. The products themselves are not changed.',
      confirmLabel: 'Delete collection',
      pendingLabel: 'Deleting…',
      action: async () => {
        await deleteCollection(collection.id);
        collectionDeleted(queryClient, collection.id);
      },
    });
    if (!done) return;
    skipBlock.current = true;
    toast.success(`${collection.title} deleted`);
    void navigate({to: '/collections'});
  };

  const imageSrc = upload?.preview ?? form.image?.src ?? null;
  const live = collection?.published && !dirty;
  const field = (id: string, error?: string) => ({id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : `${id}-hint`});

  return (
    <form className="app-page screen-collections" noValidate onSubmit={submit}>
      <BackLink />
      <PageHeader
        title={
          <span className="merch-title">
            {form.title.trim() || (isNew ? 'New collection' : collection.title)}
            {collection && <StatusBadge tone={form.published ? 'success' : 'neutral'}>{form.published ? 'Published' : 'Hidden'}</StatusBadge>}
          </span>
        }
        description={
          collection ? (
            <>
              Updated {when(collection.updatedAt)} · {productCount(form.products.length)}
              {dirty && <span className="merch-unsaved"> · Unsaved changes</span>}
            </>
          ) : (
            'Give it a title, choose the products and set their order.'
          )
        }
        actions={
          <>
            {live && (
              <a href={`/collections/${collection.slug}/`} target="_blank" rel="noopener noreferrer" className={buttonClass({variant: 'ghost', size: 'sm'})}>
                <Icon name="external" size={16} />
                View on store
              </a>
            )}
            {collection && !readOnly && (
              <Button variant="secondary" size="sm" disabled={save.isPending} onClick={() => void remove()}>
                Delete
              </Button>
            )}
            {!readOnly && (
              <Button type="submit" size="sm" pending={save.isPending} pendingLabel="Saving…" disabled={(!isNew && !dirty) || !!upload}>
                {isNew ? 'Create collection' : 'Save'}
              </Button>
            )}
          </>
        }
      />
      {status && (
        <p className="merch-status" role="alert">
          {status}
        </p>
      )}

      <fieldset disabled={readOnly || save.isPending} className="merch-fieldset">
        <div className="merch-editor-grid">
          <div className="merch-editor-main">
            <Card title="General">
              <div className="merch-form-grid">
                <Field label="Title" id="c-title" error={errors.title}>
                  <input
                    {...field('c-title', errors.title)}
                    value={form.title}
                    maxLength={120}
                    placeholder="The autumn edit"
                    onChange={e => onTitle(e.target.value)}
                  />
                </Field>
                <Field label="Slug" id="c-slug" error={errors.slug} hint={`/collections/${form.slug || slugify(form.title) || '…'}/`}>
                  <input
                    {...field('c-slug', errors.slug)}
                    value={form.slug}
                    maxLength={120}
                    onChange={e => {
                      setSlugTouched(true);
                      set('slug', e.target.value.toLowerCase());
                    }}
                  />
                </Field>
                <div className="merch-span-2">
                  <Field label="Description" id="c-desc" error={errors.description} hint="Shown under the title on the collection page and on home page cards.">
                    <RichTextEditor
                      id="c-desc"
                      label="Description"
                      value={form.description}
                      onChange={md => set('description', md)}
                      invalid={!!errors.description}
                      disabled={readOnly}
                      size="sm"
                      describedBy={errors.description ? 'c-desc-error' : 'c-desc-hint'}
                    />
                  </Field>
                </div>
              </div>
            </Card>

            <ProductsPanel products={form.products} readOnly={readOnly} error={errors.productIds} onChange={products => set('products', products)} />

            <Card title="Search engines" description="Leave empty to use the title and description.">
              <div className="merch-stack">
                <Field label="SEO title" id="c-seo-title" error={errors.seoTitle} hint={`${form.seoTitle.length} of ${SEO_TITLE_LIMIT} characters`}>
                  <input
                    {...field('c-seo-title', errors.seoTitle)}
                    value={form.seoTitle}
                    placeholder={form.title ? `${form.title} — VAREL` : ''}
                    onChange={e => set('seoTitle', e.target.value)}
                  />
                </Field>
                <Field
                  label="SEO description"
                  id="c-seo-desc"
                  error={errors.seoDescription}
                  hint={`${form.seoDescription.length} of ${SEO_DESCRIPTION_LIMIT} characters`}>
                  <textarea
                    {...field('c-seo-desc', errors.seoDescription)}
                    rows={3}
                    value={form.seoDescription}
                    placeholder={toPlainText(form.description).slice(0, SEO_DESCRIPTION_LIMIT)}
                    onChange={e => set('seoDescription', e.target.value)}
                  />
                </Field>
              </div>
            </Card>
          </div>

          <div className="merch-editor-side">
            <Card title="Visibility">
              <div className="merch-stack">
                <Switch
                  label="Published"
                  description={form.published ? 'The collection page is live.' : 'Hidden from the store. The link shows a not-found page.'}
                  checked={form.published}
                  disabled={readOnly}
                  onChange={v => set('published', v)}
                />
                <Switch
                  label="Featured on home"
                  description="Shown in the Collections section of the home page, in collection order."
                  checked={form.featuredOnHome}
                  disabled={readOnly}
                  onChange={v => set('featuredOnHome', v)}
                />
              </div>
            </Card>

            <Card title="Image" description="A 4:5 portrait works best. JPEG, PNG, WebP or AVIF up to 8 MB.">
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                hidden
                aria-label="Upload collection image"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void pickImage(f);
                  e.target.value = '';
                }}
              />
              {imageSrc ? (
                <div className="merch-stack">
                  <div className="merch-image-frame">
                    <img src={imageSrc} alt="" />
                  </div>
                  {upload && <ProgressBar value={Math.round(upload.progress * 100)} label="Uploading the collection image" />}
                  {!readOnly && (
                    <div className="merch-inline">
                      <Button variant="secondary" size="sm" disabled={!!upload} pending={!!upload} pendingLabel="Uploading…" onClick={() => fileRef.current?.click()}>
                        Replace
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!!upload} onClick={() => set('image', null)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="merch-dropzone"
                  disabled={readOnly}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e: DragEvent) => e.preventDefault()}
                  onDrop={(e: DragEvent) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) void pickImage(f);
                  }}>
                  <Icon name="image-plus" size={20} />
                  Upload an image
                  <span className="merch-dropzone-note">Without one, the first product photo is used</span>
                </button>
              )}
              {errors.image && (
                <p className="field-error" role="alert">
                  {errors.image}
                </p>
              )}
            </Card>
          </div>
        </div>
      </fieldset>
    </form>
  );
}

/* ---------- Products: picker + drag order ---------- */

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ProductsPanel({
  products,
  readOnly,
  error,
  onChange,
}: {
  products: AdminProductRow[];
  readOnly: boolean;
  error?: string;
  onChange: (next: AdminProductRow[]) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDebounced(q.trim(), 250);
  const results = useQuery({...collectionProductPickerQuery(term), enabled: open});
  const chosen = new Set(products.map(p => p.id));
  const options = (results.data?.items ?? []).filter(p => !chosen.has(p.id));

  return (
    <Card
      title="Products"
      description="Drag to set the order shown on the collection page. Draft products appear once published."
      flush
      actions={
        !readOnly && (
          <Button variant="secondary" size="sm" icon={open ? 'x' : 'plus'} onClick={() => setOpen(o => !o)} aria-expanded={open}>
            {open ? 'Done' : 'Add products'}
          </Button>
        )
      }>
      {open && (
        <div className="merch-picker">
          <SearchInput label="Search products by name or SKU" placeholder="Search products by name or SKU" value={q} onChange={e => setQ(e.target.value)} />
          <ul className="merch-picker-results" aria-label="Search results" aria-busy={results.isFetching || undefined}>
            {results.isPending ? (
              <li className="merch-picker-note">Searching…</li>
            ) : results.isError ? (
              <li className="merch-picker-note merch-danger">{results.error.message}</li>
            ) : options.length === 0 ? (
              <li className="merch-picker-note">{term ? 'No other products match.' : 'Every product is already in this collection.'}</li>
            ) : (
              options.map(p => (
                <li key={p.id} className="merch-picker-row">
                  <Thumb src={p.image?.src} />
                  <div className="merch-row-text">
                    <p className="merch-row-name">{p.name}</p>
                    <p className="merch-row-meta">
                      {p.dept} · {p.category} · {money(p.price)}
                    </p>
                  </div>
                  {p.status !== 'published' && <ProductStatusBadge status={p.status} />}
                  <Button variant="secondary" size="sm" onClick={() => onChange([...products, p])} aria-label={`Add ${p.name}`}>
                    Add
                  </Button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
      {products.length === 0 ? (
        <p className={error ? 'merch-products-empty merch-danger' : 'merch-products-empty'} role={error ? 'alert' : undefined}>
          {error ?? 'No products yet. Add a few to build the edit.'}
        </p>
      ) : (
        <>
          <SortableList
            label="Products in this collection"
            items={products}
            disabled={readOnly}
            getKey={p => p.id}
            getLabel={p => p.name}
            onReorder={onChange}
            renderItem={p => (
              <div className="merch-row">
                <Thumb src={p.image?.src} />
                <div className="merch-row-text">
                  <p className="merch-row-name">{p.name}</p>
                  <p className="merch-row-meta">
                    {p.dept} · {p.category} · {money(p.price)}
                  </p>
                </div>
                {p.status !== 'published' && <ProductStatusBadge status={p.status} />}
              </div>
            )}
            renderActions={p =>
              !readOnly && (
                <IconButton
                  icon="trash"
                  size="sm"
                  variant="danger"
                  label={`Remove ${p.name} from the collection`}
                  onClick={() => onChange(products.filter(x => x.id !== p.id))}
                />
              )
            }
          />
          {error && (
            <p className="merch-products-error field-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
