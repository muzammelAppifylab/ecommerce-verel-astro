/*
 * /dashboard/pages/$id — a CMS page's title, visibility, words and SEO, with a live preview.
 * Port of VAREL `src/pages/admin/pages/PageEditor.tsx` on the portal kit. Pages are created in code (the
 * storefront is built, not assembled), so there is no "new": `/pages/new` goes back to the list.
 */
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, Navigate, useBlocker, useNavigate, useParams} from '@tanstack/react-router';
import {useEffect, useId, useRef, useState} from 'react';

import {PAGE_SLUG, isBuiltInPage, storefrontPagePath} from '../../../components/pages/policy';
import {slugify} from '../../../lib/format';
import type {AdminPage, AdminPageInput} from '../../../lib/types/admin/content';
import {ApiError} from '../../api';
import {deletePage, pageQuery, pagesKeys, updatePage} from '../../queries/pages';
import {Button, Card, Field, Icon, LoadingBlock, Notice, PageHeader, SegmentedControl, SeoPanel, StatusBadge, useConfirm, useToast} from '../../ui';
import {BlockEditor} from './BlockEditor';
import {blockFromPost, blockToPost, emptyBlock, type EditorBlock, type FieldErrors} from './blocks';
import {dateTime} from './format';
import {PagePreview} from './PagePreview';

interface PageForm {
  title: string;
  slug: string;
  published: boolean;
  body: EditorBlock[];
  seoTitle: string;
  seoDescription: string;
}

const formOf = (p?: AdminPage): PageForm =>
  p
    ? {
        title: p.title,
        slug: p.slug,
        published: p.published,
        body: p.body.map(blockFromPost),
        seoTitle: p.seoTitle ?? '',
        seoDescription: p.seoDescription ?? '',
      }
    : {title: '', slug: '', published: false, body: [emptyBlock('p')], seoTitle: '', seoDescription: ''};

const signature = (f: PageForm) => JSON.stringify({...f, body: f.body.map(({key: _k, ...b}) => b)});

const toInput = (f: PageForm): AdminPageInput => ({
  slug: f.slug.trim() || slugify(f.title),
  title: f.title.trim(),
  published: f.published,
  body: f.body.map(blockToPost),
  seoTitle: f.seoTitle.trim() || null,
  seoDescription: f.seoDescription.trim() || null,
});

/** Client rules, mirroring the server's (routes/admin/pages.ts). */
export function validatePage(input: AdminPageInput): FieldErrors {
  const e: FieldErrors = {};
  if (!input.title) e.title = 'Give the page a title.';
  else if (input.title.length > 160) e.title = 'Keep the title under 160 characters.';
  if (!input.slug || !PAGE_SLUG.test(input.slug)) e.slug = 'Use lowercase letters, numbers and hyphens.';
  if (!input.body.length) e.body = 'Add at least one block.';
  input.body.forEach((b, i) => {
    if ((b.type === 'p' || b.type === 'h2' || b.type === 'quote') && !b.text) e[`body.${i}.text`] = 'Write the text or remove the block.';
    if (b.type === 'list' && !b.items.length) e[`body.${i}.items`] = 'Add at least one list item.';
    if (b.type === 'image' && !b.image.src) e[`body.${i}.image.src`] = 'Upload an image or paste its URL.';
  });
  if (input.seoTitle && input.seoTitle.length > 70) e.seoTitle = 'Keep the SEO title under 70 characters.';
  if (input.seoDescription && input.seoDescription.length > 200) e.seoDescription = 'Keep the SEO description under 200 characters.';
  return e;
}

export function PageEditor() {
  const {id} = useParams({from: '/pages/$id'});
  const q = useQuery({...pageQuery(id), enabled: id !== 'new'});
  if (id === 'new') return <Navigate to="/pages" replace />;
  if (q.isPending) return <EditorSkeleton />;
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="cms-screen">
        <PageHeader title={missing ? 'Page not found' : 'Page did not load'} />
        <Notice
          tone="danger"
          action={
            <span className="cms-actions">
              {!missing && (
                <Button variant="secondary" size="sm" pending={q.isRefetching} pendingLabel="Trying…" onClick={() => void q.refetch()}>
                  Try again
                </Button>
              )}
              <Link to="/pages" className="button button-secondary button-sm">
                All pages
              </Link>
            </span>
          }>
          {missing ? 'It may have been deleted, or the link is wrong.' : (q.error?.message ?? 'Try again in a moment.')}
        </Notice>
      </div>
    );
  }
  return <Editor key={q.data.id} page={q.data} />;
}

function Editor({page}: {page: AdminPage}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<PageForm>(() => formOf(page));
  const [baseline, setBaseline] = useState(() => signature(form));
  const [saved, setSaved] = useState(page);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);
  const ids = {title: useId()};

  const dirty = signature(form) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const skipGuard = useRef(false);
  useBlocker({
    shouldBlockFn: async () => {
      if (skipGuard.current || !dirtyRef.current) return false;
      const leave = await confirm({title: 'Leave without saving?', body: 'You have unsaved changes. Leave without saving?', confirmLabel: 'Leave'});
      return !leave;
    },
    enableBeforeUnload: () => dirtyRef.current && !skipGuard.current,
  });

  const set = <K extends keyof PageForm>(k: K, v: PageForm[K]) => {
    setForm(f => ({...f, [k]: v}));
    if (k === 'body') setErrors(e => Object.fromEntries(Object.entries(e).filter(([key]) => key !== 'body' && !key.startsWith('body.'))));
    else if (errors[k as string]) setErrors(({[k as string]: _drop, ...rest}) => rest);
  };

  const save = async () => {
    if (saving) return;
    const input = toInput(form);
    const errs = validatePage(input);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.danger('Check the highlighted fields.');
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.cms-screen [aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    try {
      const p = await updatePage(page.id, input);
      queryClient.setQueryData(pagesKeys.page(p.id), p);
      void queryClient.invalidateQueries({queryKey: pagesKeys.all, exact: true});
      const next = formOf(p);
      if (next.body.length === form.body.length) next.body = next.body.map((b, i) => ({...b, key: form.body[i]!.key}));
      setForm(next);
      setBaseline(signature(next));
      setSaved(p);
      toast.success('Changes saved');
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      toast.danger(e instanceof Error && e.message ? e.message : 'The page could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl + S saves.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const builtIn = isBuiltInPage(form.slug);
  const path = storefrontPagePath(form.slug);

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this page?',
      body: builtIn
        ? `“${page.title}” will be removed and the storefront goes back to its built-in copy. This cannot be undone.`
        : `“${page.title}” will be removed from the admin and the storefront. This cannot be undone.`,
      confirmLabel: 'Delete page',
      pendingLabel: 'Deleting…',
      action: () => deletePage(page.id),
    });
    if (!ok) return;
    skipGuard.current = true;
    queryClient.removeQueries({queryKey: pagesKeys.page(page.id)});
    void queryClient.invalidateQueries({queryKey: pagesKeys.all, exact: true});
    toast.success('Page deleted');
    void navigate({to: '/pages'});
  };

  const firstP = form.body.find(b => b.type === 'p')?.text ?? '';

  return (
    <div className="cms-screen">
      <Link to="/pages" className="cms-back">
        <Icon name="arrow-left" size={14} /> Pages
      </Link>
      <PageHeader
        title={
          <span className="cms-title">
            <span>{form.title || 'Untitled'}</span>
            {saved.published ? <StatusBadge tone="success">Published</StatusBadge> : <StatusBadge tone="neutral">Hidden</StatusBadge>}
            {dirty && <span className="cms-unsaved">Unsaved changes</span>}
          </span>
        }
        description={`Updated ${dateTime(saved.updatedAt)}`}
        actions={
          <>
            {saved.published && (
              <a href={storefrontPagePath(saved.slug)} target="_blank" rel="noopener noreferrer" className="button button-ghost button-sm">
                View on store <Icon name="external" size={16} />
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            )}
            <Button variant="danger" size="sm" icon="trash" disabled={saving} onClick={() => void remove()}>
              Delete
            </Button>
            <Button size="sm" pending={saving} pendingLabel="Saving…" disabled={!dirty} onClick={() => void save()}>
              Save changes
            </Button>
          </>
        }
      />

      <div className="cms-view-toggle">
        <SegmentedControl
          label="Editor view"
          value={view}
          onChange={setView}
          options={[
            {value: 'write', label: 'Write'},
            {value: 'preview', label: 'Preview'},
          ]}
        />
      </div>

      <div className="cms-editor-grid" data-view={view}>
        <form
          className="cms-editor-form"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void save();
          }}>
          <Card title="Details">
            <div className="form-stack">
              <Field label="Title" id={ids.title} error={errors.title}>
                <input
                  id={ids.title}
                  className="cms-title-input"
                  value={form.title}
                  maxLength={160}
                  disabled={saving}
                  aria-invalid={errors.title ? true : undefined}
                  aria-describedby={errors.title ? `${ids.title}-error` : undefined}
                  placeholder="Shipping information"
                  onChange={e => set('title', e.target.value)}
                />
              </Field>
              <p className="muted cms-path">
                On the store at <code>{path}</code>
              </p>
              {errors.slug && (
                <p className="field-error" role="alert">
                  {errors.slug}
                </p>
              )}
              <div className="field">
                <span className="cms-legend" id={`${ids.title}-visibility`}>
                  Visibility
                </span>
                <SegmentedControl
                  label="Visibility"
                  value={form.published ? 'published' : 'hidden'}
                  onChange={v => set('published', v === 'published')}
                  options={[
                    {value: 'published', label: 'Published'},
                    {value: 'hidden', label: 'Hidden'},
                  ]}
                />
                <p className="field-hint">
                  {builtIn ? 'Hidden falls back to the built-in copy on the storefront.' : 'Hidden pages are not on the storefront or in the sitemap.'}
                </p>
              </div>
            </div>
          </Card>

          <Card
            title="Text"
            description={
              builtIn
                ? 'The layout is built into the store; change the words here. Each heading starts a section with its own contents link.'
                : 'The layout is built into the store; change the words here.'
            }>
            <BlockEditor fixed blocks={form.body} onChange={b => set('body', b)} errors={errors} disabled={saving} />
          </Card>

          <SeoPanel
            seoTitle={form.seoTitle}
            seoDescription={form.seoDescription}
            onChange={p => {
              if (p.seoTitle !== undefined) set('seoTitle', p.seoTitle);
              if (p.seoDescription !== undefined) set('seoDescription', p.seoDescription);
            }}
            fallbackTitle={form.title}
            fallbackDescription={firstP}
            path={path}
            errors={errors}
            disabled={saving}
          />
          <button type="submit" className="visually-hidden" tabIndex={-1}>
            Save
          </button>
        </form>

        <div className="cms-editor-preview">
          <PagePreview title={form.title} blocks={form.body} />
        </div>
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="cms-screen" aria-busy="true">
      <LoadingBlock rows={6} />
    </div>
  );
}
