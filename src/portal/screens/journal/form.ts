import {z} from 'zod';

import type {AdminPost, AdminPostInput, AdminPostRow, PostBlock, PostStatus} from '../../../lib/types/admin/content';

/**
 * The journal editor's form model, port of VAREL `pages/admin/journal/form.ts`: form ⇄ input and the
 * client rules. The rules mirror the server's (`src/server/routes/admin/posts.ts`) with the same
 * dotted field keys (`body.2.text`, `image.src`), so a server 422 lands on the same fields.
 * Exported for WP-07 (CMS pages): `EditorBlock`, `emptyBlock`, `blockFromPost`, `blockToPost`, `FieldErrors`.
 */

/** True when a published post is live on the storefront (publish date reached). */
export function isLive(p: Pick<AdminPostRow, 'status' | 'publishedAt'>) {
  return p.status === 'published' && !!p.publishedAt && new Date(p.publishedAt).getTime() <= Date.now();
}

/** Editor block: a PostBlock with flat, always-present fields plus a stable key for React. */
export interface EditorBlock {
  key: string;
  type: PostBlock['type'];
  text: string; // p, h2, quote
  cite: string; // quote
  src: string; // image
  credit: string; // image
  caption: string; // image
  items: string; // list, one item per line
}

export interface PostForm {
  title: string;
  slug: string;
  category: string;
  author: string;
  excerpt: string;
  imageSrc: string;
  imageCredit: string;
  imageCreditHref: string;
  status: PostStatus;
  publishedAt: string; // datetime-local value, '' = now on publish
  body: EditorBlock[];
  seoTitle: string; // '' = use the title
  seoDescription: string; // '' = use the excerpt
}

let seq = 0;
const newKey = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyBlock(type: PostBlock['type']): EditorBlock {
  return {key: newKey(), type, text: '', cite: '', src: '', credit: '', caption: '', items: ''};
}

export const EMPTY_FORM: PostForm = {
  title: '',
  slug: '',
  category: '',
  author: '',
  excerpt: '',
  imageSrc: '',
  imageCredit: '',
  imageCreditHref: '',
  status: 'draft',
  publishedAt: '',
  body: [],
  seoTitle: '',
  seoDescription: '',
};

export function newForm(author = ''): PostForm {
  return {...EMPTY_FORM, author, body: [emptyBlock('p')]};
}

/** ISO → value for <input type="datetime-local"> in local time. */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function blockFromPost(b: PostBlock): EditorBlock {
  const e = emptyBlock(b.type);
  switch (b.type) {
    case 'p':
    case 'h2':
      return {...e, text: b.text};
    case 'quote':
      return {...e, text: b.text, cite: b.cite ?? ''};
    case 'image':
      return {...e, src: b.image.src, credit: b.image.credit ?? '', caption: b.caption ?? ''};
    case 'list':
      return {...e, items: b.items.join('\n')};
  }
}

export function blockToPost(b: EditorBlock): PostBlock {
  switch (b.type) {
    case 'p':
    case 'h2':
      return {type: b.type, text: b.text.trim()};
    case 'quote':
      return b.cite.trim() ? {type: 'quote', text: b.text.trim(), cite: b.cite.trim()} : {type: 'quote', text: b.text.trim()};
    case 'image': {
      const block: PostBlock = {type: 'image', image: {src: b.src.trim(), credit: b.credit.trim(), creditHref: ''}};
      return b.caption.trim() ? {...block, caption: b.caption.trim()} : block;
    }
    case 'list':
      return {type: 'list', items: listItems(b.items)};
  }
}

export const listItems = (s: string) =>
  s
    .split('\n')
    .map(l => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);

export function formFromPost(p: AdminPost): PostForm {
  return {
    title: p.title,
    slug: p.slug,
    category: p.category,
    author: p.author,
    excerpt: p.excerpt,
    imageSrc: p.image?.src ?? '',
    imageCredit: p.image?.credit ?? '',
    imageCreditHref: p.image?.creditHref ?? '',
    status: p.status,
    publishedAt: isoToLocal(p.publishedAt),
    body: p.body.map(blockFromPost),
    seoTitle: p.seoTitle ?? '',
    seoDescription: p.seoDescription ?? '',
  };
}

export function formToInput(f: PostForm, create: boolean): AdminPostInput {
  const input: AdminPostInput = {
    title: f.title.trim(),
    category: f.category.trim(),
    author: f.author.trim(),
    status: f.status,
    publishedAt: localToIso(f.publishedAt),
    excerpt: f.excerpt.trim(),
    image: {src: f.imageSrc.trim(), credit: f.imageCredit.trim() || null, creditHref: f.imageCreditHref.trim() || null},
    body: f.body.map(blockToPost),
    seoTitle: f.seoTitle.trim() || null,
    seoDescription: f.seoDescription.trim() || null,
  };
  if (create && f.slug.trim()) input.slug = f.slug.trim();
  return input;
}

/** Compare forms ignoring block keys. */
export const formSignature = (f: PostForm) => JSON.stringify({...f, body: f.body.map(({key: _k, ...b}) => b)});

/* ---------- Validation (field keys mirror the server's dotted paths) ---------- */

/** Same rule as the server's `isImageSrc`: an https URL or a file uploaded here. */
export const isImageSrc = (s: string) => /^https:\/\//i.test(s) || s.startsWith('/site-api/media/') || s.startsWith('/__platform/files/');

const req = (msg: string) => z.string().trim().min(1, msg);
const imageSrc = (msg: string) => req(msg).refine(isImageSrc, 'Use an https:// URL or upload the image.');

const blockSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('p'), text: req('Write the paragraph or remove the block.').max(10_000, 'Keep a paragraph under 10000 characters')}),
  z.object({type: z.literal('h2'), text: req('Add the heading text or remove the block.').max(200, 'Keep a heading under 200 characters')}),
  z.object({
    type: z.literal('quote'),
    text: req('Add the quote or remove the block.').max(2000, 'Keep a quote under 2000 characters'),
    cite: z.string().max(200, 'Keep the citation under 200 characters').optional(),
  }),
  z.object({
    type: z.literal('image'),
    image: z.object({
      src: imageSrc('Upload an image or paste its URL.'),
      credit: z.string().max(200, 'Keep the credit under 200 characters').nullish(),
    }),
    caption: z.string().max(300, 'Keep the caption under 300 characters').optional(),
  }),
  z.object({
    type: z.literal('list'),
    items: z
      .array(z.string().max(1000, 'Keep a list item under 1000 characters'))
      .min(1, 'Add at least one list item.')
      .max(50, 'Keep a list under 50 items'),
  }),
]);

const inputSchema = z.object({
  slug: z
    .string()
    .max(120, 'Keep the slug under 120 characters')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens.')
    .refine(s => !['categories', 'feed', 'sitemap'].includes(s), 'That slug is reserved')
    .optional(),
  title: req('Give the post a title.').max(160, 'Keep the title under 160 characters.'),
  category: req('Choose or type a category.').max(60, 'Keep the category short.'),
  author: req('Who wrote this?').max(80, 'Keep the author under 80 characters.'),
  excerpt: req('Write a one- or two-line excerpt.').max(320, 'Keep the excerpt under 320 characters.'),
  image: z.object({
    src: imageSrc('Add a cover image.'),
    credit: z.string().max(200, 'Keep the credit under 200 characters').nullish(),
    creditHref: z
      .string()
      .max(2000, 'Keep the link under 2000 characters')
      .refine(s => /^https?:\/\/\S+$/i.test(s), 'Enter a full URL, starting https://')
      .nullish(),
  }),
  body: z.array(blockSchema).min(1, 'Add at least one block.').max(500, 'Keep the body under 500 blocks'),
  seoTitle: z.string().max(70, 'Keep the SEO title under 70 characters').nullish(),
  seoDescription: z.string().max(200, 'Keep the SEO description under 200 characters').nullish(),
});

export type FieldErrors = Record<string, string>;

export function validate(input: AdminPostInput): FieldErrors {
  const r = inputSchema.safeParse(input);
  if (r.success) return {};
  const out: FieldErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Errors for one block, from keys like `body.2.text` / `body.2.image.src`. */
export function blockError(errors: FieldErrors, i: number): string | undefined {
  const prefix = `body.${i}`;
  for (const [k, v] of Object.entries(errors)) if (k === prefix || k.startsWith(`${prefix}.`)) return v;
  return undefined;
}
