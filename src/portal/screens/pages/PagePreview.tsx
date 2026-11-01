/* Live preview of a CMS page as the store shows it (title + blocks), with portal classes (the storefront's
   Tailwind cannot load in the dashboard): VAREL PageEditor `Preview` + journal `PostBody`. */
import {useMemo} from 'react';

import {photoUrl} from '../../../lib/format';
import {blockToPost, type EditorBlock} from './blocks';

export function PagePreview({title, blocks}: {title: string; blocks: EditorBlock[]}) {
  const body = useMemo(
    () => blocks.filter(b => (b.type === 'image' ? !!b.src.trim() : b.type === 'list' ? !!b.items.trim() : !!b.text.trim())).map(blockToPost),
    [blocks]
  );
  const firstP = body.findIndex(b => b.type === 'p');
  return (
    <section aria-label="Live preview" className="cms-preview">
      <header className="cms-preview-head">
        <h3>Preview</h3>
        <span className="muted">As it appears on the store</span>
      </header>
      <div className="cms-preview-scroll">
        <div className="cms-preview-title">
          <p className="cms-preview-h1">{title || <span className="muted">Untitled page</span>}</p>
        </div>
        <div className="cms-preview-body cms-prose">
          {body.length ? (
            body.map((b, i) => {
              switch (b.type) {
                case 'p':
                  return (
                    <p key={i} className={i === firstP ? 'cms-standfirst' : undefined}>
                      {b.text}
                    </p>
                  );
                case 'h2':
                  return (
                    <p key={i} className="cms-prose-h2">
                      {b.text}
                    </p>
                  );
                case 'quote':
                  return (
                    <blockquote key={i}>
                      <p>“{b.text.replace(/^[“"]|[”"]$/g, '')}”</p>
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
            })
          ) : (
            <p className="muted">Add blocks to see the body.</p>
          )}
        </div>
      </div>
    </section>
  );
}
