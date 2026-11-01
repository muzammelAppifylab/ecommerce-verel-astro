/* Product editor panels for merchandising (featured) and search appearance (SEO) (VAREL `ProductExtrasPanels.tsx`).
   The preview uses the kit's `.seo-preview` classes (no inline font style: CSP). */
import {toPlainText} from '../../../lib/rich-text';
import {Card, clipText, Field, Switch} from '../../ui';
import {type FieldErrors, type ProductForm, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX} from './form';
import type {SetField} from './ProductSections';

export function MerchandisingPanel({form, set, disabled}: {form: ProductForm; set: SetField; disabled?: boolean}) {
  return (
    <Card title="Merchandising">
      <Switch
        label="Featured"
        description="Shown in the featured row on the home page."
        checked={form.featured}
        disabled={disabled}
        onChange={v => set('featured', v)}
      />
    </Card>
  );
}

function Counter({n, max}: {n: number; max: number}) {
  return (
    <span className="seo-count" data-tone={n > max ? 'warning' : undefined}>
      {n}/{max}
      {n > max && ' · may be cut off'}
    </span>
  );
}

export function SeoPanel({
  form,
  set,
  errors,
  disabled,
  onBlur,
}: {
  form: ProductForm;
  set: SetField;
  errors: FieldErrors;
  disabled?: boolean;
  onBlur: (path: string) => void;
}) {
  const fallbackTitle = `${form.name.trim() || 'Product name'} — VAREL`;
  const fallbackDesc = (form.short.trim() || toPlainText(form.description)).replace(/\s+/g, ' ').trim();
  const title = form.seoTitle.trim() || fallbackTitle;
  const desc = form.seoDescription.trim() || fallbackDesc;
  const host = typeof window === 'undefined' ? 'varel.studio' : window.location.host;
  return (
    <Card title="Search engine listing" description="How the product page appears in search results and link previews.">
      <div className="editor-fields">
        <div className="seo-preview" role="group" aria-label="Search result preview">
          <p className="seo-preview-url">
            {host} › product › {form.id || 'slug'}
          </p>
          <p className="seo-preview-title">{clipText(title, SEO_TITLE_MAX + 5)}</p>
          <p className="seo-preview-description">
            {desc ? clipText(desc, SEO_DESCRIPTION_MAX) : <span className="muted">Add a description so search results show a summary.</span>}
          </p>
        </div>
        <Field id="p-seo-title" label="Title" error={errors.seoTitle} hint={<Counter n={form.seoTitle.trim().length} max={SEO_TITLE_MAX} />}>
          <input
            id="p-seo-title"
            value={form.seoTitle}
            placeholder={fallbackTitle}
            disabled={disabled}
            onChange={e => set('seoTitle', e.target.value)}
            onBlur={() => onBlur('seoTitle')}
            aria-invalid={errors.seoTitle ? true : undefined}
            aria-describedby={errors.seoTitle ? 'p-seo-title-error' : 'p-seo-title-hint'}
          />
        </Field>
        <Field
          id="p-seo-desc"
          label="Description"
          error={errors.seoDescription}
          hint={<Counter n={form.seoDescription.trim().length} max={SEO_DESCRIPTION_MAX} />}>
          <textarea
            id="p-seo-desc"
            rows={3}
            value={form.seoDescription}
            placeholder={fallbackDesc ? clipText(fallbackDesc, SEO_DESCRIPTION_MAX) : 'A sentence or two about the piece'}
            disabled={disabled}
            onChange={e => set('seoDescription', e.target.value)}
            onBlur={() => onBlur('seoDescription')}
            aria-invalid={errors.seoDescription ? true : undefined}
            aria-describedby={errors.seoDescription ? 'p-seo-desc-error' : 'p-seo-desc-hint'}
          />
        </Field>
        <p className="editor-note">Leave empty to use the product name and short description.</p>
      </div>
    </Card>
  );
}
