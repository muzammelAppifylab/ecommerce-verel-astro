/*
 * Add, edit, reorder and remove PostBlocks: VAREL `pages/admin/journal/BlockEditor.tsx` on the portal kit.
 * `fixed`: the layout is set in code; only the words and images change (the Pages editor).
 */
import {useRef} from 'react';

import type {PostBlock} from '../../../lib/types/content';
import {IconButton} from '../../ui';
import {blockError, emptyBlock, type EditorBlock, type FieldErrors} from './blocks';
import {ImageSource} from './ImageSource';

const TYPES: {type: PostBlock['type']; label: string}[] = [
  {type: 'p', label: 'Paragraph'},
  {type: 'h2', label: 'Heading'},
  {type: 'quote', label: 'Quote'},
  {type: 'image', label: 'Image'},
  {type: 'list', label: 'List'},
];
const LABEL = Object.fromEntries(TYPES.map(t => [t.type, t.label])) as Record<PostBlock['type'], string>;

export function BlockEditor({
  blocks,
  onChange,
  errors,
  fixed,
  disabled,
}: {
  blocks: EditorBlock[];
  onChange: (blocks: EditorBlock[]) => void;
  errors: FieldErrors;
  fixed?: boolean;
  disabled?: boolean;
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
    // keep focus on the moved block's button
    requestAnimationFrame(() => listRef.current?.children[j]?.querySelector<HTMLButtonElement>(`[data-move="${d}"]`)?.focus());
  };
  const add = (type: PostBlock['type'], at = blocks.length) => {
    const next = [...blocks];
    next.splice(at, 0, emptyBlock(type));
    onChange(next);
    requestAnimationFrame(() => listRef.current?.children[at]?.querySelector<HTMLElement>('textarea, input')?.focus());
  };

  return (
    <div className="cms-blocks">
      {errors.body && (
        <p role="alert" className="field-error" id="body-error">
          {errors.body}
        </p>
      )}
      <ol ref={listRef} className="cms-block-list">
        {blocks.map((b, i) => {
          const err = blockError(errors, i);
          const fid = `block-${b.key}`;
          const errId = `${fid}-error`;
          const invalid = err ? true : undefined;
          const describedBy = err ? errId : undefined;
          return (
            <li key={b.key} className="cms-block" data-invalid={err ? '' : undefined} aria-label={`Block ${i + 1}: ${LABEL[b.type]}`}>
              <div className="cms-block-head">
                <span className="cms-block-index">{i + 1}</span>
                {fixed ? (
                  <span className="cms-block-type">{LABEL[b.type]}</span>
                ) : (
                  <>
                    <label htmlFor={`${fid}-type`} className="visually-hidden">
                      Block type
                    </label>
                    <select
                      id={`${fid}-type`}
                      className="cms-block-select"
                      value={b.type}
                      disabled={disabled}
                      onChange={e => update(i, {type: e.target.value as PostBlock['type']})}>
                      {TYPES.map(t => (
                        <option key={t.type} value={t.type}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <span className="cms-block-tools">
                      <IconButton icon="chevron-up" size="sm" label="Move block up" data-move="-1" disabled={disabled || i === 0} onClick={() => move(i, -1)} />
                      <IconButton
                        icon="chevron-down"
                        size="sm"
                        label="Move block down"
                        data-move="1"
                        disabled={disabled || i === blocks.length - 1}
                        onClick={() => move(i, 1)}
                      />
                      <IconButton icon="trash" size="sm" label="Remove block" disabled={disabled} onClick={() => remove(i)} />
                    </span>
                  </>
                )}
              </div>

              <div className="cms-block-body">
                {(b.type === 'p' || b.type === 'quote') && (
                  <div className="field">
                    <label htmlFor={fid} className="visually-hidden">
                      {b.type === 'p' ? 'Paragraph text' : 'Quote text'}
                    </label>
                    <textarea
                      id={fid}
                      rows={b.type === 'quote' ? 2 : 3}
                      className={b.type === 'quote' ? 'cms-quote-input' : undefined}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      disabled={disabled}
                      value={b.text}
                      placeholder={b.type === 'p' ? (i === 0 ? 'Opening paragraph (shown as the standfirst)…' : 'Paragraph…') : 'The quote…'}
                      onChange={e => update(i, {text: e.target.value})}
                    />
                  </div>
                )}
                {b.type === 'h2' && (
                  <div className="field">
                    <label htmlFor={fid} className="visually-hidden">
                      Heading text
                    </label>
                    <input
                      id={fid}
                      className="cms-heading-input"
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      disabled={disabled}
                      value={b.text}
                      placeholder="Section heading"
                      onChange={e => update(i, {text: e.target.value})}
                    />
                  </div>
                )}
                {b.type === 'quote' && (
                  <div className="field">
                    <label htmlFor={`${fid}-cite`} className="visually-hidden">
                      Citation
                    </label>
                    <input
                      id={`${fid}-cite`}
                      value={b.cite}
                      disabled={disabled}
                      placeholder="Citation (optional), e.g. Ana Lund, founder"
                      onChange={e => update(i, {cite: e.target.value})}
                    />
                  </div>
                )}
                {b.type === 'image' && (
                  <>
                    <ImageSource value={b.src} onChange={src => update(i, {src})} label="Block image" invalid={!!err} errorId={errId} disabled={disabled} />
                    <div className="grid-2 cms-grid">
                      <div className="field">
                        <label htmlFor={`${fid}-caption`} className="visually-hidden">
                          Caption
                        </label>
                        <input
                          id={`${fid}-caption`}
                          value={b.caption}
                          disabled={disabled}
                          placeholder="Caption (optional)"
                          onChange={e => update(i, {caption: e.target.value})}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`${fid}-credit`} className="visually-hidden">
                          Photo credit
                        </label>
                        <input
                          id={`${fid}-credit`}
                          value={b.credit}
                          disabled={disabled}
                          placeholder="Credit (optional)"
                          onChange={e => update(i, {credit: e.target.value})}
                        />
                      </div>
                    </div>
                  </>
                )}
                {b.type === 'list' && (
                  <div className="field">
                    <label htmlFor={fid} className="visually-hidden">
                      List items, one per line
                    </label>
                    <textarea
                      id={fid}
                      rows={4}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      disabled={disabled}
                      value={b.items}
                      placeholder={'One item per line\nSecond item'}
                      onChange={e => update(i, {items: e.target.value})}
                    />
                  </div>
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
        <div className="cms-block-add">
          <span className="muted">Add block</span>
          {TYPES.map(t => (
            <button key={t.type} type="button" className="button button-secondary button-sm" disabled={disabled} onClick={() => add(t.type)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
