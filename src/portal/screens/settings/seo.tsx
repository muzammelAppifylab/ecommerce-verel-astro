import {Link} from '@tanstack/react-router';
import {useRef, useState} from 'react';

import {Button, Field, imageFileProblem, SearchPreview, uploadImage} from '../../ui';
import {IMAGE_LINK_RE, SETTINGS_LIMITS as L} from './limits';
import {type Errors, fieldAria, Section, type SettingsCodec, SettingsShell, useSettingsDraft} from './shared';

/** Settings · SEO (port of VAREL `pages/admin/seo/SeoSettings.tsx`): default title and description, and the share image. */

/** The storefront's own defaults (VAREL `src/lib/seo.ts`), shown when the fields are empty. */
export const DEFAULT_TITLE = 'VAREL — Modern essentials. Considered deeply.';
export const DEFAULT_DESCRIPTION =
  'VAREL — modern essentials, considered deeply. Clothing, footwear, bags and accessories cut from natural fibres in small runs.';

interface SeoForm {
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
}

export const seoCodec: SettingsCodec<SeoForm> = {
  toForm: s => ({seoTitle: s.seoTitle ?? '', seoDescription: s.seoDescription ?? '', ogImage: s.ogImage ?? ''}),
  toValues: f => ({seoTitle: f.seoTitle.trim(), seoDescription: f.seoDescription.trim(), ogImage: f.ogImage.trim() || null}),
  validate: f => {
    const e: Errors = {};
    if (f.seoTitle.trim().length > L.seoTitle) e.seoTitle = `Keep it under ${L.seoTitle} characters.`;
    if (f.seoDescription.trim().length > L.seoDescription) e.seoDescription = `Keep it under ${L.seoDescription} characters.`;
    const img = f.ogImage.trim();
    if (img && (img.length > L.imageLink || !IMAGE_LINK_RE.test(img))) e.ogImage = 'Upload an image or paste an https:// link.';
    return e;
  },
};

export function SeoSettings() {
  const draft = useSettingsDraft(seoCodec);
  const {set, touch, errors, ro} = draft;
  const host = typeof window === 'undefined' ? '' : window.location.host;
  return (
    <SettingsShell title="SEO" description="How the store appears in search results and when a link is shared." draft={draft}>
      {f => {
        const title = f.seoTitle.trim() || DEFAULT_TITLE;
        const desc = f.seoDescription.trim() || DEFAULT_DESCRIPTION;
        return (
          <>
            <Section
              id="defaults"
              title="Search defaults"
              description="Used for the home page, and for any page without its own title or description. Products, journal posts and pages have their own SEO fields.">
              <Field label="Default title" id="s-seo-title" error={errors.seoTitle} hint={`${f.seoTitle.trim().length}/60 shown in results`}>
                <input
                  id="s-seo-title"
                  value={f.seoTitle}
                  placeholder={DEFAULT_TITLE}
                  maxLength={L.seoTitle}
                  onChange={e => set({seoTitle: e.target.value})}
                  onBlur={() => touch('seoTitle')}
                  {...fieldAria('s-seo-title', errors.seoTitle)}
                />
              </Field>
              <Field label="Default description" id="s-seo-desc" error={errors.seoDescription} hint={`${f.seoDescription.trim().length}/160 shown in results`}>
                <textarea
                  id="s-seo-desc"
                  rows={3}
                  value={f.seoDescription}
                  placeholder={DEFAULT_DESCRIPTION}
                  maxLength={L.seoDescription}
                  onChange={e => set({seoDescription: e.target.value})}
                  onBlur={() => touch('seoDescription')}
                  {...fieldAria('s-seo-desc', errors.seoDescription)}
                />
              </Field>
              <div>
                <p className="settings-label">Search preview</p>
                <SearchPreview title={title} description={desc} url={host} />
              </div>
            </Section>

            <Section
              id="share"
              title="Share image"
              description="Shown when a link to the store is shared and the page has no image of its own. 1200 × 630 works everywhere.">
              {ro ? (
                <div>
                  <p className="settings-label">Image</p>
                  <p className="muted">{f.ogImage || 'No share image'}</p>
                </div>
              ) : (
                <ImageLinkField
                  id="s-og"
                  label="Image"
                  value={f.ogImage}
                  onChange={ogImage => set({ogImage})}
                  onBlur={() => touch('ogImage')}
                  error={errors.ogImage}
                />
              )}
              <div>
                <p className="settings-label">Link preview</p>
                <div className="settings-share">
                  <div className="settings-share-media">
                    {f.ogImage.trim() && IMAGE_LINK_RE.test(f.ogImage.trim()) ? (
                      <img src={f.ogImage.trim()} alt="" />
                    ) : (
                      <span className="settings-share-wordmark">VAREL</span>
                    )}
                  </div>
                  <div className="settings-share-text">
                    <p className="settings-share-host">{host}</p>
                    <p className="settings-share-title">{title}</p>
                    <p className="settings-share-desc">{desc}</p>
                  </div>
                </div>
              </div>
            </Section>

            <Section id="files" title="Crawlers" description="Generated from the catalog and journal on every request.">
              <ul className="settings-links">
                <li>
                  <a href="/sitemap.xml" target="_blank" rel="noopener noreferrer">
                    /sitemap.xml
                  </a>
                  <span className="muted"> · published products, collections, posts and pages</span>
                </li>
                <li>
                  <a href="/robots.txt" target="_blank" rel="noopener noreferrer">
                    /robots.txt
                  </a>
                  <span className="muted"> · keeps the admin, account and checkout out of search</span>
                </li>
                <li className="muted">
                  Page-level fields live in <Link to="/pages">Pages</Link> and <Link to="/journal">Journal</Link>.
                </li>
              </ul>
            </Section>
          </>
        );
      }}
    </SettingsShell>
  );
}

/** A single image: a thumbnail, a URL field ("https://… or upload") and an Upload button (platform files, public). */
export function ImageLinkField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    const bad = imageFileProblem(file);
    if (bad) return setProblem(bad);
    setProblem(null);
    setUploading(true);
    try {
      const {url} = await uploadImage(file);
      onChange(url);
    } catch (err) {
      setProblem(err instanceof Error && err.message ? err.message : 'The image could not be uploaded. Try again.');
    } finally {
      setUploading(false);
    }
  }

  const message = problem ?? error;
  const shown = value.trim() && IMAGE_LINK_RE.test(value.trim()) ? value.trim() : null;
  return (
    <Field label={label} id={id} error={message} hint="Paste an https:// link or upload a JPG, PNG, WebP or AVIF under 8 MB">
      <span className="settings-image-field">
        <span className="settings-image-thumb">{shown ? <img src={shown} alt="" /> : <span className="muted">No image</span>}</span>
        <input
          id={id}
          value={value}
          placeholder="https://… or upload"
          spellCheck={false}
          onChange={e => {
            setProblem(null);
            onChange(e.target.value);
          }}
          onBlur={onBlur}
          {...fieldAria(id, message)}
        />
        <Button variant="secondary" size="sm" icon="upload" pending={uploading} pendingLabel="Uploading…" onClick={() => input.current?.click()}>
          Upload
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          className="visually-hidden"
          tabIndex={-1}
          aria-label={`${label} file`}
          onChange={e => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </span>
    </Field>
  );
}
