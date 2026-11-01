import {useMemo} from 'react';

import {headingIds, quoteText} from '../../../components/journal/headings';
import {dotJoin, photoUrl} from '../../../lib/format';
import type {PostBlock} from '../../../lib/types/admin/content';
import {blockToPost, type PostForm} from './form';

/**
 * The editor's live preview (VAREL `PostEditor` `Preview`): the storefront article's header, cover and
 * body, rendered in the portal with `.post-preview` classes (screen.css) that copy the storefront's
 * `PostBody.astro` measure, standfirst, Cormorant subheads and chalk pull quotes.
 */

/** PostBlock[] as the storefront renders them (same heading ids and quote handling as `PostBody.astro`). WP-07 reuses it. */
export function PreviewBody({body}: {body: PostBlock[]}) {
  const firstP = body.findIndex(b => b.type === 'p');
  const ids = headingIds(body);
  return (
    <div className="post-preview-body">
      {body.map((b, i) => {
        switch (b.type) {
          case 'p':
            return (
              <p key={i} className={i === firstP ? 'post-preview-standfirst' : undefined}>
                {b.text}
              </p>
            );
          case 'h2':
            return (
              <h2 key={i} id={`preview-${ids.get(i)}`}>
                {b.text}
              </h2>
            );
          case 'quote':
            return (
              <blockquote key={i}>
                <p>“{quoteText(b.text)}”</p>
                {b.cite && <footer>{b.cite}</footer>}
              </blockquote>
            );
          case 'list':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            );
          case 'image':
            return (
              <figure key={i}>
                <img src={photoUrl(b.image, 900)} alt={b.caption ?? ''} loading="lazy" />
                {b.caption && <figcaption>{b.caption}</figcaption>}
              </figure>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/** Storefront rendering of the current form (header, cover and body). */
export function Preview({form}: {form: PostForm}) {
  const body = useMemo(
    () =>
      form.body
        .filter(b => (b.type === 'image' ? !!b.src.trim() : b.type === 'list' ? !!b.items.trim() : !!b.text.trim()))
        .map(blockToPost),
    [form.body]
  );
  const date = form.publishedAt
    ? new Date(form.publishedAt).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'})
    : 'Today';
  // VAREL's preview estimate (~220 words a minute, rounded); the saved post uses the server's figure.
  const words = form.body.reduce((n, b) => n + `${b.text} ${b.items} ${b.caption}`.trim().split(/\s+/).filter(Boolean).length, 0);
  const read = `${Math.max(1, Math.round(words / 220))} min read`;

  return (
    <section aria-label="Live preview" className="post-preview">
      <header className="post-preview-head">
        <h3>Preview</h3>
        <span>As it appears on the journal</span>
      </header>
      <div className="post-preview-scroll">
        <article>
          <div className="post-preview-intro">
            <span className="post-preview-meta">{dotJoin(form.category || 'Category', date, read)}</span>
            <p className="post-preview-title">{form.title || <span className="muted">Untitled post</span>}</p>
            {form.excerpt && <p className="post-preview-excerpt">{form.excerpt}</p>}
            <div className="post-preview-byline">{form.author || '—'}</div>
          </div>
          {form.imageSrc ? (
            <img className="post-preview-cover" src={photoUrl(form.imageSrc, 1200)} alt="" />
          ) : (
            <div className="post-preview-nocover">No cover image</div>
          )}
          <div className="post-preview-main">
            {body.length ? <PreviewBody body={body} /> : <p className="muted">Add blocks to see the body.</p>}
          </div>
        </article>
      </div>
    </section>
  );
}
