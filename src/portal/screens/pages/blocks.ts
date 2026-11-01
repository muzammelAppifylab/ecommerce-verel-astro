/*
 * Editor blocks for CMS page bodies (PostBlock[]): VAREL `src/pages/admin/journal/form.ts` (the block half),
 * kept in this folder so the Pages editor does not wait on the journal package (WP-06).
 */
import {PAGE_SLUG} from '../../../components/pages/policy';
import type {AdminPageInput} from '../../../lib/types/admin/content';
import type {PostBlock} from '../../../lib/types/content';

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

export type FieldErrors = Record<string, string>;

let seq = 0;
const newKey = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyBlock(type: PostBlock['type']): EditorBlock {
  return {key: newKey(), type, text: '', cite: '', src: '', credit: '', caption: '', items: ''};
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

export const listItems = (s: string) =>
  s
    .split('\n')
    .map(l => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);

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

/** Errors for one block, from keys like `body.2.text` / `body.2.image.src`. */
export function blockError(errors: FieldErrors, i: number): string | undefined {
  const prefix = `body.${i}`;
  for (const [k, v] of Object.entries(errors)) if (k === prefix || k.startsWith(`${prefix}.`)) return v;
  return undefined;
}

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
