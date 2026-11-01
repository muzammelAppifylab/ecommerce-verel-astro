import {type KeyboardEvent, type ReactNode, useId, useMemo, useState} from 'react';

import {Button} from './button';
import {RichTextEditor} from './rich-text-editor';

/**
 * The translation editor for ONE field in ONE language, ported from VAREL
 * (`components/admin/TranslationEditor.tsx`), used by Settings · Languages
 * (WP-25 builds the screen around it): plain text, rich text with the
 * formatting toolbar, or structured fields (post bodies, menu items, hero
 * copy) edited per text leaf or as JSON, with the shape checked.
 * Enter in a one-line field or ⌘/Ctrl+Enter saves.
 */

/** One translatable field of a record (VAREL `EntityField`, the part the editor needs). */
export interface TranslatableField {
  field: string;
  /** Source value in the default locale; JSON-encoded for structured fields. */
  sourceValue: string;
  json: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  short: 'Short description',
  description: 'Description',
  material: 'Material',
  care: 'Care',
  color: 'Colour',
  title: 'Title',
  excerpt: 'Excerpt',
  body: 'Body',
  seoTitle: 'SEO title',
  seoDescription: 'SEO description',
  items: 'Menu items',
  detail: 'Detail',
  label: 'Label',
  note: 'Note',
  subject: 'Subject',
  announcement: 'Announcement',
  termsText: 'Terms text',
  returnReasons: 'Return reasons',
  homeHero: 'Home hero',
  catalog: 'Catalog',
};

/** A field's name for people: "seoTitle" → "SEO title", "careNotes" → "Care Notes". */
export const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

/** Rich text → its words, for the source column (the storefront renders the formatting). */
export const richToPlain = (html: string) =>
  html
    .replace(/<\/?(p|h[1-6]|ul|ol|li|blockquote|div|br|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|#39);/g, m => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"})[m] ?? m)
    .replace(/\n{2,}/g, '\n')
    .trim();

function Side({label, hint, children}: {label: string; hint?: string; children: ReactNode}) {
  return (
    <div className="tr-side">
      <p className="tr-label">
        <span>{label}</span>
        {hint && <span className="tr-hint">{hint}</span>}
      </p>
      <div className="tr-source">{children}</div>
    </div>
  );
}

export function TranslationEditor({
  field: f,
  rich,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  field: TranslatableField;
  /** A rich text field: edited with the formatting toolbar. */
  rich?: boolean;
  initial: string;
  saving: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const source = f.json ? parseJson(f.sourceValue) : undefined;
  if (f.json && source !== undefined) return <JsonEditor source={source} initial={initial} saving={saving} onSave={onSave} onCancel={onCancel} />;
  return <TextEditor source={f.sourceValue} rich={rich} initial={initial} saving={saving} onSave={onSave} onCancel={onCancel} />;
}

function EditorActions({
  saving,
  onSave,
  onCancel,
  disabled,
  extra,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="tr-actions">
      <Button size="sm" pending={saving} pendingLabel="Saving…" disabled={disabled} onClick={onSave}>
        Save translation
      </Button>
      <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      {extra}
      <span className="tr-note">Saved as a manual translation. Automatic updates will not replace it.</span>
    </div>
  );
}

function TextEditor({
  source,
  rich,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  source: string;
  rich?: boolean;
  initial: string;
  saving: boolean;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const long = source.length > 80 || source.includes('\n');
  const id = useId();
  return (
    // Not a <form>: the panel sits inside the editors' own forms. ⌘Enter saves.
    <div className="tr-editor" onKeyDown={event => saveKey(event, () => v.trim() && onSave(v))}>
      <div className="tr-grid">
        <Side label="Source">{!source ? <span className="muted">Empty</span> : rich ? richToPlain(source) : source}</Side>
        <div className="tr-side">
          <label htmlFor={id} className="tr-label">
            Translation
          </label>
          {rich ? (
            <RichTextEditor id={id} label="Translation" value={v} onChange={setV} size="sm" />
          ) : long ? (
            <textarea
              id={id}
              className="tr-input"
              autoFocus
              rows={Math.min(10, Math.max(3, Math.ceil(source.length / 70)))}
              value={v}
              onChange={event => setV(event.target.value)}
            />
          ) : (
            <input id={id} className="tr-input" autoFocus value={v} onChange={event => setV(event.target.value)} />
          )}
        </div>
      </div>
      <EditorActions saving={saving} onSave={() => onSave(v)} onCancel={onCancel} disabled={!v.trim()} />
    </div>
  );
}

function JsonEditor({
  source,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  source: unknown;
  initial: string;
  saving: boolean;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  // Start from the existing translation when it has the same shape as the source, otherwise from the source.
  const start = useMemo(() => {
    const t = initial ? parseJson(initial) : undefined;
    return t !== undefined && sameShape(source, t) ? t : clone(source);
  }, [initial, source]);
  const [doc, setDoc] = useState<unknown>(start);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const srcLeaves = useMemo(() => textLeaves(source), [source]);
  const jsonId = useId();

  function submit() {
    if (raw !== null) {
      const p = parseJson(raw);
      if (p === undefined) return setError('This is not valid JSON.');
      if (!sameShape(source, p)) return setError('Keep the same structure as the source. Only change the text.');
      onSave(JSON.stringify(p));
    } else onSave(JSON.stringify(doc));
  }

  return (
    <div className="tr-editor" onKeyDown={event => saveKey(event, submit)}>
      {raw === null ? (
        <ul className="tr-leaves">
          {srcLeaves.map(l => {
            const val = getAt(doc, l.path);
            const id = `${jsonId}-leaf-${l.key}`;
            const long = l.value.length > 80;
            return (
              <li key={l.key} className="tr-grid">
                <Side label={l.label}>{l.value}</Side>
                <div className="tr-side">
                  <label htmlFor={id} className="tr-label">
                    Translation
                  </label>
                  {long ? (
                    <textarea
                      id={id}
                      className="tr-input"
                      rows={Math.min(8, Math.ceil(l.value.length / 70))}
                      value={typeof val === 'string' ? val : ''}
                      onChange={event => setDoc((d: unknown) => setAt(d, l.path, event.target.value))}
                    />
                  ) : (
                    <input
                      id={id}
                      className="tr-input"
                      value={typeof val === 'string' ? val : ''}
                      onChange={event => setDoc((d: unknown) => setAt(d, l.path, event.target.value))}
                    />
                  )}
                </div>
              </li>
            );
          })}
          {!srcLeaves.length && <li className="muted">There is no text to translate in this field.</li>}
        </ul>
      ) : (
        <div className="field" data-invalid={error ? '' : undefined}>
          <label htmlFor={`${jsonId}-json`}>JSON</label>
          <textarea
            id={`${jsonId}-json`}
            className="tr-input tr-json"
            rows={12}
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${jsonId}-error` : undefined}
            value={raw}
            onChange={event => {
              setRaw(event.target.value);
              setError(null);
            }}
          />
        </div>
      )}
      {error && (
        <p className="field-error" id={`${jsonId}-error`} role="alert">
          {error}
        </p>
      )}
      <EditorActions
        saving={saving}
        onSave={submit}
        onCancel={onCancel}
        extra={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (raw === null) setRaw(JSON.stringify(doc, null, 2));
              else {
                const p = parseJson(raw);
                if (p === undefined || !sameShape(source, p)) return setError('Fix the JSON before switching back.');
                setDoc(p);
                setRaw(null);
              }
              setError(null);
            }}>
            {raw === null ? 'Edit as JSON' : 'Edit as text'}
          </Button>
        }
      />
    </div>
  );
}

/** Enter in a one-line field or ⌘/Ctrl+Enter anywhere saves the translation, and never submits the editor's own form. */
function saveKey(event: KeyboardEvent<HTMLDivElement>, save: () => unknown) {
  if (event.key !== 'Enter') return;
  const single = (event.target as HTMLElement).tagName === 'INPUT';
  if (single || event.metaKey || event.ctrlKey) {
    event.preventDefault();
    save();
  }
}

// ------------------------------------------------------ structured values --

export type LeafPath = (string | number)[];
export interface TextLeaf {
  key: string;
  path: LeafPath;
  label: string;
  value: string;
}

/** Keys that hold links, media or identifiers rather than text. */
const NON_TEXT = new Set(['url', 'href', 'src', 'id', 'type', 'image', 'photo', 'slug', 'credit', 'width', 'height', 'alt_id']);

export function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The translatable text leaves of a structured value (links, ids and media keys skipped). */
export function textLeaves(v: unknown, path: LeafPath = [], out: TextLeaf[] = []): TextLeaf[] {
  if (typeof v === 'string') {
    if (v.trim() && !/^(https?:|\/|#|mailto:)/.test(v)) out.push({key: path.join('.') || 'value', path, label: leafLabel(path), value: v});
  } else if (Array.isArray(v)) v.forEach((x, i) => textLeaves(x, [...path, i], out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!NON_TEXT.has(k)) textLeaves(x, [...path, k], out);
  return out;
}

function leafLabel(path: LeafPath): string {
  const parts = path.map(p => (typeof p === 'number' ? String(p + 1) : p === 'items' ? 'item' : fieldLabel(p).toLowerCase()));
  if (!parts.length) return 'Text';
  const s = parts.join(' · ');
  return s[0]!.toUpperCase() + s.slice(1);
}

export function getAt(v: unknown, path: LeafPath): unknown {
  return path.reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string | number, unknown>)[k]), v);
}

export function setAt(v: unknown, path: LeafPath, value: string): unknown {
  if (!path.length) return value;
  const copy = clone(v) as Record<string | number, unknown>;
  let cur = copy;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!] as Record<string | number, unknown>;
  cur[path[path.length - 1]!] = value;
  return copy;
}

/** Same array lengths, object keys and non-text value types: a translation may only change text. */
export function sameShape(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameShape(x, b[i]));
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    const ka = Object.keys(a as object);
    return ka.every(k => k in (b as object) && sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return typeof a === typeof b;
}
