import type {Photo} from '../../../lib/types/common';
import type {AdminProductRow} from '../../../lib/types/admin/catalog';
import type {AdminCollection, AdminCollectionInput} from '../../../lib/types/admin/merchandising';

/**
 * The collection editor's form model (VAREL `CollectionEditor.tsx` `Form`, `formOf`, `inputOf`), kept
 * apart from the screen so it is unit-tested (tests/collections.test.ts).
 */

export interface CollectionForm {
  title: string;
  slug: string;
  description: string;
  image: Photo | null;
  published: boolean;
  featuredOnHome: boolean;
  seoTitle: string;
  seoDescription: string;
  products: AdminProductRow[];
}

export const EMPTY_COLLECTION_FORM: CollectionForm = {
  title: '',
  slug: '',
  description: '',
  image: null,
  published: true,
  featuredOnHome: false,
  seoTitle: '',
  seoDescription: '',
  products: [],
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SEO_TITLE_LIMIT = 70;
export const SEO_DESCRIPTION_LIMIT = 170;

export const formOfCollection = (c: AdminCollection): CollectionForm => ({
  title: c.title,
  slug: c.slug,
  description: c.description,
  image: c.image,
  published: c.published,
  featuredOnHome: c.featuredOnHome,
  seoTitle: c.seoTitle ?? '',
  seoDescription: c.seoDescription ?? '',
  products: c.products,
});

/** What the API takes: trimmed text, `''` slug → undefined, `''` SEO → null, product ids in order. */
export const inputOfCollection = (f: CollectionForm): AdminCollectionInput => ({
  title: f.title.trim(),
  slug: f.slug.trim() || undefined,
  description: f.description.trim(),
  image: f.image,
  published: f.published,
  featuredOnHome: f.featuredOnHome,
  seoTitle: f.seoTitle.trim() || null,
  seoDescription: f.seoDescription.trim() || null,
  productIds: f.products.map(p => p.id),
});

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** An edit sends only what changed (concurrent edits of other fields survive). */
export function changedFields(next: AdminCollectionInput, before: AdminCollectionInput): Partial<AdminCollectionInput> {
  return Object.fromEntries(
    Object.entries(next).filter(([k, v]) => !sameValue(v, before[k as keyof AdminCollectionInput]))
  ) as Partial<AdminCollectionInput>;
}

/** The client rules (they mirror the server's): title after the first submit, slug pattern, SEO lengths. */
export function collectionFormErrors(form: CollectionForm, attempted: boolean, server: Record<string, string>): Record<string, string | undefined> {
  return {
    title: (attempted && !form.title.trim() ? 'Enter a title' : undefined) ?? server.title,
    slug: (form.slug && !SLUG_PATTERN.test(form.slug) ? 'Use lowercase letters, numbers and single dashes' : undefined) ?? server.slug,
    description: server.description,
    image: server.image ?? server['image.src'] ?? server['image.creditHref'],
    seoTitle: form.seoTitle.length > SEO_TITLE_LIMIT ? `Keep the SEO title under ${SEO_TITLE_LIMIT} characters` : server.seoTitle,
    seoDescription:
      form.seoDescription.length > SEO_DESCRIPTION_LIMIT ? `Keep the SEO description under ${SEO_DESCRIPTION_LIMIT} characters` : server.seoDescription,
    productIds: server.productIds,
  };
}
