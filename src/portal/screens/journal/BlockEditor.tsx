import {useRef} from 'react';

import type {PostBlock} from '../../../lib/types/admin/content';
import {Button, IconButton} from '../../ui';
import {blockError, emptyBlock, type EditorBlock, type FieldErrors} from './form';
import {ImageSource} from './ImageSource';

/** Port of VAREL `pages/admin/journal/BlockEditor.tsx`. WP-07 (CMS pages) imports it. */

export const BLOCK_TYPES: {type: PostBlock['type']; label: string}[] = [
  {type: 'p', label: 'Paragraph'},
  {type: 'h2', label: 'Heading'},
  {type: 'quote', label: 'Quote'},
  {type: 'image', label: 'Image'},
  {type: 'list', label: 'List'},
];
const LABEL = Object.fromEntries(BLOCK_TYPES.map(t => [t.type, t.label])) as Record<PostBlock['type'], string>;

export type {EditorBlock, FieldErrors};

/** Add, edit, reorder and remove PostBlocks. `fixed`: the layout is set in code; only the words and images change. */
export function BlockEditor({
  blocks,
  onChange,
  errors,
  fixed,
}: {
  blocks: EditorBlock[];
  onChange: (blocks: EditorBlock[]) => void;
  errors: FieldErrors;
  fixed?: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  const update = (i: number, patch: Partial<EditorBlock>) => onChange(blocks.map((b, j) => (j === i ? {...b, ...patch} : b)));
  const remove = (i: number) => onChange(blocks.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
    // Keep focus on the moved block's button (or its other one at the ends).
    requestAnimationFrame(() => {
      const item = listRef.current?.children[j];
      const btn =
        item?.querySelector<HTMLButtonElement>(`[data-move="${d}"]:not(:disabled)`) ??
        item?.querySelector<HTMLButtonElement>(`[data-move="${-d}"]`);
      btn?.focus();
    });
  };
  const add = (type: PostBlock['type'], at = blocks.length) => {
    const next = [...blocks];
    next.splice(at, 0, emptyBlock(type));
    onChange(next);
    requestAnimationFrame(() => {
      listRef.current?.children[at]?.querySelector<HTMLElement>('textarea, input')?.focus();
    });
  };

  return (
    <div className="journal-blocks">
      {errors.body && (
        <p role="alert" className="field-error">
          {errors.body}
        </p>
      )}
      <ol ref={listRef} className="journal-block-list">
        {blocks.map((b, i) => {
          const err = blockError(errors, i);
          const fid = `block-${b.key}`;
          const errId = err ? `${fid}-error` : undefined;
          return (
            <li key={b.key} className="journal-block" data-invalid={err ? '' : undefined} aria-label={`Block ${i + 1}: ${LABEL[b.type]}`}>
              <div className="journal-block-head">
                <span className="journal-block-n">{i + 1}</span>
                {fixed ? (
                  <span className="journal-block-type">{LABEL[b.type]}</span>
                ) : (
                  <>
                    <label htmlFor={`${fid}-type`} className="visually-hidden">
                      Block type
                    </label>
                    <select
                      id={`${fid}-type`}
                      className="journal-block-select"
                      value={b.type}
                      onChange={e => update(i, {type: e.target.value as PostBlock['type']})}>
                      {BLOCK_TYPES.map(t => (
                        <option key={t.type} value={t.type}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <div className="journal-block-tools">
                      <IconButton icon="chevron-up" size="sm" label="Move block up" data-move="-1" disabled={i === 0} onClick={() => move(i, -1)} />
                      <IconButton
                        icon="chevron-down"
                        size="sm"
                        label="Move block down"
                        data-move="1"
                        disabled={i === blocks.length - 1}
                        onClick={() => move(i, 1)}
                      />
                      <IconButton icon="trash" size="sm" label="Remove block" onClick={() => remove(i)} />
                    </div>
                  </>
                )}
              </div>

              <div className="journal-block-body field">
                {(b.type === 'p' || b.type === 'quote') && (
                  <textarea
                    id={fid}
                    aria-label={b.type === 'p' ? 'Paragraph text' : 'Quote text'}
                    aria-invalid={!!err || undefined}
                    aria-describedby={errId}
                    className={b.type === 'quote' ? 'journal-quote-input' : undefined}
                    rows={b.type === 'quote' ? 2 : 3}
                    value={b.text}
                    placeholder={b.type === 'p' ? (i === 0 ? 'Opening paragraph (shown as the standfirst)…' : 'Paragraph…') : 'The quote…'}
                    onChange={e => update(i, {text: e.target.value})}
                  />
                )}
                {b.type === 'h2' && (
                  <input
                    id={fid}
                    aria-label="Heading text"
                    aria-invalid={!!err || undefined}
                    aria-describedby={errId}
                    className="journal-heading-input"
                    value={b.text}
                    placeholder="Section heading"
                    onChange={e => update(i, {text: e.target.value})}
                  />
                )}
                {b.type === 'quote' && (
                  <input
                    aria-label="Citation"
                    value={b.cite}
                    placeholder="Citation (optional), e.g. Ana Lund, founder"
                    onChange={e => update(i, {cite: e.target.value})}
                  />
                )}
                {b.type === 'image' && (
                  <>
                    <ImageSource value={b.src} onChange={src => update(i, {src})} label="Block image" invalid={!!err} describedBy={errId} />
                    <div className="journal-block-pair">
                      <input aria-label="Caption" value={b.caption} placeholder="Caption (optional)" onChange={e => update(i, {caption: e.target.value})} />
                      <input aria-label="Photo credit" value={b.credit} placeholder="Credit (optional)" onChange={e => update(i, {credit: e.target.value})} />
                    </div>
                  </>
                )}
                {b.type === 'list' && (
                  <textarea
                    id={fid}
                    aria-label="List items, one per line"
                    aria-invalid={!!err || undefined}
                    aria-describedby={errId}
                    rows={3}
                    value={b.items}
                    placeholder={'One item per line\nSecond item'}
                    onChange={e => update(i, {items: e.target.value})}
                  />
                )}
                {err && (
                  <p role="alert" className="field-error" id={errId}>
                    {err}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!fixed && (
        <div className="journal-block-add">
          <span className="journal-block-add-label">Add block</span>
          {BLOCK_TYPES.map(t => (
            <Button key={t.type} variant="secondary" size="sm" icon="plus" onClick={() => add(t.type)}>
              {t.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
