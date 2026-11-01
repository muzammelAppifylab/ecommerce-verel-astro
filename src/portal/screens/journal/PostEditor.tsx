import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useBlocker, useNavigate} from '@tanstack/react-router';
import {useEffect, useId, useRef, useState} from 'react';

import {dotJoin, slugify} from '../../../lib/format';
import type {AdminPost, AdminPostInput} from '../../../lib/types/admin/content';
import {ApiError} from '../../api';
import {createPost, deletePost, invalidatePosts, postCategoriesQuery, postKeys, updatePost} from '../../queries/journal';
import {useMe, when} from '../../shared';
import {Button, buttonClass, Card, Field, Icon, Notice, PageHeader, SegmentedControl, SeoPanel, useConfirm, useToast} from '../../ui';
import {BlockEditor} from './BlockEditor';
import {type FieldErrors, formFromPost, formSignature, formToInput, isLive, newForm, type PostForm, validate} from './form';
import {ImageSource} from './ImageSource';
import {PostStatusBadge} from './JournalActions';
import {Preview} from './Preview';

/**
 * Create (no `post`) or edit a journal post: details, publishing, block body, SEO and a live storefront
 * preview. Port of VAREL `pages/admin/journal/PostEditor.tsx` (full-page editor, not a drawer).
 */

const TOO_LARGE = 'This post is too long to save in one go (64 KB). Shorten it or split it.';

const describe = (id: string, error?: string, hint?: boolean) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

export function PostEditor({post}: {post?: AdminPost}) {
  const create = !post;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const me = useMe();
  const categories = useQuery(postCategoriesQuery);
  const meName = me.data?.viewer.name ?? '';

  const [form, setForm] = useState<PostForm>(() => (post ? formFromPost(post) : newForm(meName)));
  const [baseline, setBaseline] = useState(() => formSignature(form));
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<string | null>(null);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [saved, setSaved] = useState<AdminPost | undefined>(post);

  const base = useId();
  const ids = {
    title: `${base}-title`,
    slug: `${base}-slug`,
    category: `${base}-category`,
    cats: `${base}-cats`,
    author: `${base}-author`,
    excerpt: `${base}-excerpt`,
    cover: `${base}-cover`,
    credit: `${base}-credit`,
    creditHref: `${base}-credit-href`,
    date: `${base}-date`,
  };

  // Author defaults to the signed-in staff member once /me resolves, without dirtying the form.
  useEffect(() => {
    if (create && meName && !form.author && baseline === formSignature({...form, author: ''})) {
      setForm(f => ({...f, author: meName}));
      setBaseline(formSignature({...form, author: meName}));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meName]);

  const dirty = formSignature(form) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const skipGuard = useRef(false);

  useBlocker({
    shouldBlockFn: async () => {
      if (skipGuard.current || !dirtyRef.current) return false;
      const leave = await confirm({
        title: 'Leave without saving?',
        body: 'You have unsaved changes. Leave without saving?',
        confirmLabel: 'Leave',
        tone: 'danger',
      });
      return !leave;
    },
    enableBeforeUnload: () => dirtyRef.current && !skipGuard.current,
  });

  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) => {
    setForm(f => {
      const next = {...f, [k]: v};
      if (k === 'title' && create && !slugTouched) next.slug = slugify(String(v)).slice(0, 120);
      return next;
    });
    if (errors[k as string]) setErrors(({[k as string]: _drop, ...rest}) => rest);
    if (k === 'imageSrc' && errors['image.src']) setErrors(({'image.src': _drop, ...rest}) => rest);
    if (k === 'imageCreditHref' && errors['image.creditHref']) setErrors(({'image.creditHref': _drop, ...rest}) => rest);
    if (k === 'body') setErrors(e => Object.fromEntries(Object.entries(e).filter(([key]) => key !== 'body' && !key.startsWith('body.'))));
  };

  const createM = useMutation({mutationFn: (input: AdminPostInput) => createPost(input)});
  const updateM = useMutation({mutationFn: (input: AdminPostInput) => updatePost(post?.slug ?? '', input)});
  const busy = createM.isPending || updateM.isPending;
  // Which header button started the save, for its spinner.
  const [acting, setActing] = useState<'draft' | 'published' | 'save' | null>(null);

  const onError = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 413) {
        setStatus(TOO_LARGE);
        toast.danger('The post could not be saved.');
        return;
      }
      const fields = {...e.fields};
      if (e.status === 409 && !fields.slug) fields.slug = e.message || 'That slug is already in use.';
      if (Object.keys(fields).length) {
        setErrors(fields);
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.screen-journal [aria-invalid="true"]')?.focus());
      }
    }
    const message = e instanceof Error && e.message ? e.message : 'The post could not be saved.';
    setStatus(message);
    toast.danger(message);
  };

  const save = (statusOverride?: PostForm['status']) => {
    setStatus(null);
    const f = statusOverride ? {...form, status: statusOverride} : form;
    const input = formToInput(f, create);
    const errs = validate(input);
    if (create && !input.slug && !slugify(input.title)) errs.slug = 'Add a slug.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.danger('Check the highlighted fields.');
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.screen-journal [aria-invalid="true"]')?.focus());
      return;
    }
    setActing(statusOverride ?? 'save');
    if (statusOverride) setForm(f);
    if (create) {
      createM.mutate(input, {
        onSuccess: p => {
          skipGuard.current = true;
          invalidatePosts(qc, true);
          qc.setQueryData(postKeys.detail(p.slug), p);
          toast.success(p.status === 'published' ? 'Post published' : 'Draft saved');
          void navigate({to: '/journal/$slug', params: {slug: p.slug}, replace: true});
        },
        onError,
      });
    } else {
      updateM.mutate(input, {
        onSuccess: p => {
          const next = formFromPost(p);
          // Keep block keys so inputs keep focus.
          if (next.body.length === f.body.length) next.body = next.body.map((b, i) => ({...b, key: f.body[i]!.key}));
          setForm(next);
          setBaseline(formSignature(next));
          const was = saved?.status;
          setSaved(p);
          qc.setQueryData(postKeys.detail(p.slug), p);
          invalidatePosts(qc, true);
          toast.success(
            p.status === 'published' && was !== 'published'
              ? 'Post published'
              : p.status === 'draft' && was === 'published'
                ? 'Moved to drafts'
                : 'Changes saved'
          );
        },
        onError,
      });
    }
  };

  // Cmd/Ctrl + S saves.
  const saveRef = useRef(() => save());
  saveRef.current = () => {
    if (!busy) save();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const live = saved ? isLive(saved) : false;

  const doDelete = async () => {
    if (!post) return;
    const ok = await confirm({
      title: 'Delete this post?',
      body: `“${post.title}” will be removed from the admin${live ? ' and the storefront journal' : ''}. This cannot be undone.`,
      confirmLabel: 'Delete post',
      pendingLabel: 'Deleting…',
      action: () => deletePost(post.slug),
    });
    if (!ok) return;
    skipGuard.current = true;
    qc.removeQueries({queryKey: postKeys.detail(post.slug)});
    invalidatePosts(qc, true);
    toast.success('Post deleted');
    void navigate({to: '/journal'});
  };

  const futureDate = !!form.publishedAt && new Date(form.publishedAt).getTime() > Date.now();
  const scheduled = form.status === 'published' && futureDate;
  const dateHint =
    form.status === 'draft'
      ? 'Drafts never appear on the storefront.'
      : scheduled
        ? 'Scheduled: appears on the journal at this time.'
        : form.publishedAt
          ? 'Live on the journal.'
          : 'Leave empty to publish now.';
  const coverError = errors['image.src'] ?? errors.image;

  return (
    <div className="app-page screen-journal">
      <Link to="/journal" className="journal-back">
        <Icon name="arrow-left" size={14} /> Journal
      </Link>
      <PageHeader
        title={
          <span className="journal-editor-title">
            <span>{create ? 'New post' : form.title || 'Untitled'}</span>
            {saved && <PostStatusBadge post={saved} />}
            {dirty && <span className="journal-unsaved">Unsaved changes</span>}
          </span>
        }
        description={saved ? dotJoin(`Updated ${when(saved.updatedAt)}`, saved.read) : undefined}
        actions={
          <>
            {saved && live && (
              <a href={`/journal/${saved.slug}/`} target="_blank" rel="noopener noreferrer" className={buttonClass({variant: 'ghost', size: 'sm'})}>
                View on store <Icon name="external" size={16} />
              </a>
            )}
            {!create && (
              <Button variant="secondary" size="sm" icon="trash" disabled={busy} onClick={() => void doDelete()}>
                Delete
              </Button>
            )}
            {(create || saved?.status === 'draft') && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  pending={busy && acting === 'draft'}
                  pendingLabel="Saving…"
                  disabled={busy || (!create && !dirty)}
                  onClick={() => save('draft')}>
                  Save draft
                </Button>
                <Button
                  size="sm"
                  pending={busy && acting === 'published'}
                  pendingLabel={futureDate ? 'Scheduling…' : 'Publishing…'}
                  disabled={busy}
                  onClick={() => save('published')}>
                  {futureDate ? 'Schedule' : 'Publish'}
                </Button>
              </>
            )}
            {!create && saved?.status === 'published' && (
              <>
                <Button variant="secondary" size="sm" pending={busy && acting === 'draft'} pendingLabel="Moving…" disabled={busy} onClick={() => save('draft')}>
                  Move to drafts
                </Button>
                <Button size="sm" pending={busy && acting === 'save'} pendingLabel="Saving…" disabled={busy || !dirty} onClick={() => save()}>
                  Save changes
                </Button>
              </>
            )}
          </>
        }
      />

      {status && (
        <div className="journal-status">
          <Notice tone="danger">{status}</Notice>
        </div>
      )}

      {/* Write / Preview toggle below 1280px; side by side above. */}
      <div className="journal-view-toggle">
        <SegmentedControl
          label="Editor view"
          options={[
            {value: 'write', label: 'Write'},
            {value: 'preview', label: 'Preview'},
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      <div className="journal-editor" data-view={view}>
        <form
          className="journal-editor-form"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            if (!busy) save();
          }}>
          <Card title="Details">
            <div className="journal-grid">
              <div className="journal-span">
                <Field label="Title" id={ids.title} error={errors.title}>
                  <input
                    id={ids.title}
                    className="journal-title-input"
                    value={form.title}
                    aria-invalid={!!errors.title || undefined}
                    aria-describedby={describe(ids.title, errors.title)}
                    onChange={e => set('title', e.target.value)}
                    placeholder="The case for linen in winter"
                  />
                </Field>
              </div>
              <div className="journal-span">
                <Field
                  label="Slug"
                  id={ids.slug}
                  error={errors.slug}
                  hint={create ? 'Generated from the title. It cannot change after the post is created.' : 'Fixed after creation.'}>
                  <div className="journal-slug">
                    <span className="journal-slug-prefix" aria-hidden="true">
                      /journal/
                    </span>
                    <input
                      id={ids.slug}
                      value={form.slug}
                      readOnly={!create}
                      aria-readonly={!create || undefined}
                      aria-invalid={!!errors.slug || undefined}
                      aria-describedby={describe(ids.slug, errors.slug, true)}
                      onChange={e => {
                        setSlugTouched(true);
                        set('slug', slugify(e.target.value.replace(/\s+/g, '-')) || e.target.value.toLowerCase());
                      }}
                    />
                  </div>
                </Field>
              </div>
              <Field label="Category" id={ids.category} error={errors.category}>
                <>
                  <input
                    id={ids.category}
                    list={ids.cats}
                    value={form.category}
                    aria-invalid={!!errors.category || undefined}
                    aria-describedby={describe(ids.category, errors.category)}
                    onChange={e => set('category', e.target.value)}
                    placeholder="Choose or type a new one"
                  />
                  <datalist id={ids.cats}>
                    {categories.data?.map(c => <option key={c.name} value={c.name} />)}
                  </datalist>
                </>
              </Field>
              <Field label="Author" id={ids.author} error={errors.author}>
                <input
                  id={ids.author}
                  value={form.author}
                  aria-invalid={!!errors.author || undefined}
                  aria-describedby={describe(ids.author, errors.author)}
                  onChange={e => set('author', e.target.value)}
                />
              </Field>
              <div className="journal-span">
                <Field
                  label="Excerpt"
                  id={ids.excerpt}
                  error={errors.excerpt}
                  hint={`${form.excerpt.trim().length}/320 · shown on journal cards and under the title`}>
                  <textarea
                    id={ids.excerpt}
                    rows={2}
                    value={form.excerpt}
                    aria-invalid={!!errors.excerpt || undefined}
                    aria-describedby={describe(ids.excerpt, errors.excerpt, true)}
                    onChange={e => set('excerpt', e.target.value)}
                  />
                </Field>
              </div>
              <div className="journal-span">
                <Field label="Cover image" id={ids.cover} error={coverError}>
                  <ImageSource
                    id={ids.cover}
                    value={form.imageSrc}
                    onChange={v => set('imageSrc', v)}
                    label="Cover image"
                    wide
                    invalid={!!coverError}
                    describedBy={describe(ids.cover, coverError)}
                  />
                </Field>
              </div>
              <Field label="Photo credit" id={ids.credit} error={errors['image.credit']} optional>
                <input
                  id={ids.credit}
                  value={form.imageCredit}
                  aria-invalid={!!errors['image.credit'] || undefined}
                  aria-describedby={describe(ids.credit, errors['image.credit'])}
                  onChange={e => set('imageCredit', e.target.value)}
                  placeholder="Photo by … on Unsplash"
                />
              </Field>
              <Field label="Credit link" id={ids.creditHref} error={errors['image.creditHref']} optional>
                <input
                  id={ids.creditHref}
                  value={form.imageCreditHref}
                  aria-invalid={!!errors['image.creditHref'] || undefined}
                  aria-describedby={describe(ids.creditHref, errors['image.creditHref'])}
                  onChange={e => set('imageCreditHref', e.target.value)}
                  placeholder="https://unsplash.com/…"
                />
              </Field>
            </div>
          </Card>

          <Card title="Publishing">
            <div className="journal-grid">
              <div className="journal-status-field">
                <span className="journal-legend" id={`${base}-status`}>
                  Status
                </span>
                <SegmentedControl
                  label="Status"
                  options={[
                    {value: 'draft', label: 'Draft'},
                    {value: 'published', label: 'Published'},
                  ]}
                  value={form.status}
                  onChange={v => set('status', v)}
                />
              </div>
              <Field label="Publish date" id={ids.date} error={errors.publishedAt} hint={dateHint}>
                <input
                  id={ids.date}
                  type="datetime-local"
                  value={form.publishedAt}
                  aria-invalid={!!errors.publishedAt || undefined}
                  aria-describedby={describe(ids.date, errors.publishedAt, true)}
                  onChange={e => set('publishedAt', e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card title="Body" description="Blocks render top to bottom, exactly as on the storefront.">
            <BlockEditor blocks={form.body} onChange={b => set('body', b)} errors={errors} />
          </Card>

          <SeoPanel
            seoTitle={form.seoTitle}
            seoDescription={form.seoDescription}
            onChange={p => Object.entries(p).forEach(([k, v]) => set(k as 'seoTitle' | 'seoDescription', v ?? ''))}
            fallbackTitle={form.title ? `${form.title} — Journal` : ''}
            fallbackDescription={form.excerpt}
            path={`/journal/${form.slug || 'new-post'}/`}
            errors={errors}
          />
          <button type="submit" className="visually-hidden" tabIndex={-1}>
            Save
          </button>
        </form>

        <div className="journal-editor-preview">
          <Preview form={form} />
        </div>
      </div>
    </div>
  );
}
