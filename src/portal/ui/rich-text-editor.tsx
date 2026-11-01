import {Highlight} from '@tiptap/extension-highlight';
import {Subscript} from '@tiptap/extension-subscript';
import {Superscript} from '@tiptap/extension-superscript';
import {TextAlign} from '@tiptap/extension-text-align';
import {Color, TextStyle} from '@tiptap/extension-text-style';
import {Placeholder} from '@tiptap/extensions';
import {Markdown} from '@tiptap/markdown';
import {type Editor, EditorContent, useEditor, useEditorState} from '@tiptap/react';
import {StarterKit} from '@tiptap/starter-kit';
import {type ReactNode, useEffect, useId, useRef, useState} from 'react';

import {Button} from './button';
import {Icon, type IconName} from './icon';
import {Popover} from './popover';

/**
 * Rich text for descriptions (products, collections, translations): block
 * styles, inline styles, colour, highlight, alignment and links, saved as HTML
 * that the storefront rebuilds from an allowlist. Ported from VAREL's
 * `components/admin/RichTextEditor.tsx`: same extensions, same toolbar, same
 * shortcuts, same stored HTML.
 *
 * CSP: the editor's DOM carries the stored `style="color: …"` /
 * `style="text-align: …"` attributes, which the site's CSP does not apply.
 * `app.css` paints the palette colours and alignments from those attributes
 * with attribute selectors instead (`.rte-content [style*=…]`), so nothing is
 * rewritten and the saved HTML stays byte for byte what VAREL saved.
 */

// ---------------------------------------------------------------- palette --

/** The editor's palette (VAREL `src/lib/rich-text.ts`). The storefront accepts any hex, so retiring a swatch never breaks old text. */
export const TEXT_COLORS = [
  {name: 'Obsidian', value: '#1A1A1A', className: 'obsidian'},
  {name: 'Graphite', value: '#3D3D3D', className: 'graphite'},
  {name: 'Stone', value: '#6E6E6E', className: 'stone'},
  {name: 'Moss', value: '#3F5B45', className: 'moss'},
  {name: 'Rust', value: '#8A3A2E', className: 'rust'},
  {name: 'Ochre', value: '#7A6A4F', className: 'ochre'},
] as const;

export const HIGHLIGHTS = [
  {name: 'Chalk', value: '#ECECEC', className: 'chalk'},
  {name: 'Pebble', value: '#D9D9D9', className: 'pebble'},
  {name: 'Moss', value: '#DFE6E0', className: 'moss'},
  {name: 'Rust', value: '#F2E2DE', className: 'rust'},
  {name: 'Ochre', value: '#EFE9DC', className: 'ochre'},
] as const;

/** Editor output starts with a block element; anything else is older plain text / Markdown. */
export const isRichHtml = (s: string) => /^\s*<(p|h[1-6]|ul|ol|blockquote|hr|div)[\s>/]/i.test(s);

/** Only these links survive; anything else (javascript:, data:) is refused. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  if (h.startsWith('#')) return h;
  return null;
}

/** What a typed link address becomes: a full URL, a mailto: for an email address, or `null` when it is not allowed. */
export function normalizeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const url = /^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(v) ? v : v.includes('@') && !v.includes('/') ? `mailto:${v}` : `https://${v}`;
  return safeHref(url);
}

// ------------------------------------------------------------- extensions --

// Lazy (functions, not module constants): importing the kit must not pull the editor into every screen's bundle.
const isMac = () => typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);
const modKey = () => (isMac() ? '⌘' : 'Ctrl+');
const altKey = () => (isMac() ? '⌥' : 'Alt+');

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const LEVELS: HeadingLevel[] = [1, 2, 3, 4, 5, 6];
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

/** The `text-align` in an element's raw style attribute (the CSP leaves `element.style` empty). */
const rawStyle = (element: HTMLElement, property: string) =>
  new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(element.getAttribute('style') ?? '')?.[1]?.trim();

/** TextAlign that reads the raw attribute, so a stored alignment survives the CSP. Renders exactly as TextAlign. */
const cspTextAlign = () =>
  TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (element: HTMLElement) => {
              const alignment = element.style.textAlign || rawStyle(element, 'text-align') || '';
              return this.options.alignments.includes(alignment) ? alignment : this.options.defaultAlignment;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.textAlign === 'string' && this.options.alignments.includes(attributes.textAlign)
                ? {style: `text-align: ${attributes.textAlign}`}
                : {},
          },
        },
      },
    ];
  },
});

/** Everything the storefront rich text renders. No code blocks, tables or images. */
const extensions = (placeholder?: string) => [
  StarterKit.configure({
    heading: {levels: LEVELS},
    code: false,
    codeBlock: false,
    link: {openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: {target: null, rel: null}},
  }),
  cspTextAlign().configure({types: ['heading', 'paragraph'], alignments: [...ALIGNMENTS]}),
  TextStyle,
  Color,
  Highlight.configure({multicolor: true}),
  Subscript,
  Superscript,
  // Only to read descriptions saved as Markdown before the editor wrote HTML.
  Markdown,
  Placeholder.configure({placeholder: placeholder ?? ''}),
];

// ----------------------------------------------------------------- editor --

/**
 * `<RichTextEditor id label value onChange />`. A `<label for>` cannot name a
 * contenteditable, so `label` is required (the accessible name); wrap it in a
 * `Field` for the visible label, hint and error as usual.
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  label,
  placeholder,
  invalid,
  disabled,
  size = 'md',
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (html: string) => void;
  /** Accessible name. */
  label: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Minimum height of the text area: sm 120px, md 160px (VAREL's default), lg 240px. */
  size?: 'sm' | 'md' | 'lg';
  describedBy?: string;
}) {
  // What we last sent or received, so outside changes (load, reset after save) replace the content without
  // echoing the editor's own updates back into it.
  const last = useRef(value);
  const editor = useEditor({
    extensions: extensions(placeholder),
    content: value,
    contentType: isRichHtml(value) ? 'html' : 'markdown',
    editable: !disabled,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(describedBy ? {'aria-describedby': describedBy} : {}),
        class: `rich-text rte-content rte-h-${size}`,
      },
    },
    onUpdate: ({editor: current, transaction}) => {
      // Loading content (Markdown parsed on mount, setContent from outside) is not an edit: only report changes
      // the person made, or every opened record would read as "unsaved". Toolbar commands focus the editor first.
      if (!transaction.docChanged || !current.isFocused) return;
      const html = current.isEmpty ? '' : current.getHTML();
      last.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor || value === last.current) return;
    last.current = value;
    editor.commands.setContent(value, {contentType: isRichHtml(value) ? 'html' : 'markdown', emitUpdate: false});
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {attributes: {...(editor.options.editorProps.attributes as Record<string, string>), 'aria-invalid': invalid ? 'true' : 'false'}},
    });
  }, [editor, invalid]);

  return (
    <div className="rte" data-invalid={invalid ? '' : undefined} data-disabled={disabled ? '' : undefined}>
      {editor && <Toolbar editor={editor} controls={id} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({editor, controls}: {editor: Editor; controls: string}) {
  const s = useEditorState({
    editor,
    selector: ({editor: e}) => ({
      level: (LEVELS.find(l => e.isActive('heading', {level: l})) ?? 0) as HeadingLevel | 0,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      sub: e.isActive('subscript'),
      sup: e.isActive('superscript'),
      color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      highlight: e.isActive('highlight') ? ((e.getAttributes('highlight').color as string | undefined) ?? HIGHLIGHTS[0].value) : null,
      link: e.isActive('link'),
      align: (['center', 'right', 'justify'] as const).find(a => e.isActive({textAlign: a})) ?? 'left',
      ul: e.isActive('bulletList'),
      ol: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const run = () => editor.chain().focus();
  const MOD = modKey();
  const MAC = isMac();

  return (
    <div role="toolbar" aria-label="Formatting" aria-controls={controls} className="rte-toolbar">
      <BlockStyle editor={editor} level={s.level} />
      <Divider />
      <Tool label="Bold" shortcut={`${MOD}B`} on={s.bold} icon="bold" onClick={() => run().toggleBold().run()} />
      <Tool label="Italic" shortcut={`${MOD}I`} on={s.italic} icon="italic" onClick={() => run().toggleItalic().run()} />
      <Tool label="Underline" shortcut={`${MOD}U`} on={s.underline} icon="underline" onClick={() => run().toggleUnderline().run()} />
      <Tool label="Strikethrough" shortcut={`${MOD}Shift+S`} on={s.strike} icon="strikethrough" onClick={() => run().toggleStrike().run()} />
      <Tool label="Subscript" shortcut={`${MOD},`} on={s.sub} icon="subscript" onClick={() => run().unsetSuperscript().toggleSubscript().run()} />
      <Tool label="Superscript" shortcut={`${MOD}.`} on={s.sup} icon="superscript" onClick={() => run().unsetSubscript().toggleSuperscript().run()} />
      <Divider />
      <Swatches
        kind="color"
        label="Text colour"
        icon="baseline"
        current={s.color}
        colors={TEXT_COLORS}
        clearLabel="Default colour"
        onPick={c => run().setColor(c).run()}
        onClear={() => run().unsetColor().run()}
      />
      <Swatches
        kind="highlight"
        label="Highlight"
        shortcut={`${MOD}Shift+H`}
        icon="highlighter"
        current={s.highlight}
        colors={HIGHLIGHTS}
        clearLabel="No highlight"
        onPick={c => run().setHighlight({color: c}).run()}
        onClear={() => run().unsetHighlight().run()}
      />
      <LinkTool editor={editor} on={s.link} />
      <Divider />
      <Tool label="Align left" shortcut={`${MOD}Shift+L`} on={s.align === 'left'} icon="align-left" onClick={() => run().setTextAlign('left').run()} />
      <Tool label="Align centre" shortcut={`${MOD}Shift+E`} on={s.align === 'center'} icon="align-center" onClick={() => run().setTextAlign('center').run()} />
      <Tool label="Align right" shortcut={`${MOD}Shift+R`} on={s.align === 'right'} icon="align-right" onClick={() => run().setTextAlign('right').run()} />
      <Tool label="Justify" shortcut={`${MOD}Shift+J`} on={s.align === 'justify'} icon="align-justify" onClick={() => run().setTextAlign('justify').run()} />
      <Divider />
      <Tool label="Bulleted list" shortcut={`${MOD}Shift+8`} on={s.ul} icon="list" onClick={() => run().toggleBulletList().run()} />
      <Tool label="Numbered list" shortcut={`${MOD}Shift+7`} on={s.ol} icon="list-ordered" onClick={() => run().toggleOrderedList().run()} />
      <Tool label="Quote" shortcut={`${MOD}Shift+B`} on={s.quote} icon="quote" onClick={() => run().toggleBlockquote().run()} />
      <Tool label="Divider line" icon="minus" onClick={() => run().setHorizontalRule().run()} />
      <Divider />
      <Tool label="Clear formatting" icon="remove-formatting" onClick={() => run().unsetAllMarks().clearNodes().unsetTextAlign().run()} />
      <span className="rte-toolbar-end">
        <Tool label="Undo" shortcut={`${MOD}Z`} disabled={!s.undo} icon="undo" onClick={() => run().undo().run()} />
        <Tool label="Redo" shortcut={MAC ? '⌘Shift+Z' : 'Ctrl+Y'} disabled={!s.redo} icon="redo" onClick={() => run().redo().run()} />
      </span>
    </div>
  );
}

function Tool({
  label,
  shortcut,
  on,
  disabled,
  icon,
  onClick,
  children,
  buttonRef,
  expanded,
}: {
  label: string;
  shortcut?: string;
  on?: boolean;
  disabled?: boolean;
  icon?: IconName;
  onClick: () => void;
  children?: ReactNode;
  buttonRef?: (node: HTMLButtonElement | null) => void;
  expanded?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="rte-tool"
      aria-label={label}
      aria-pressed={on === undefined ? undefined : on}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      aria-expanded={expanded}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      // Keep the selection in the editor while clicking the toolbar.
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="rte-divider" />;

// ------------------------------------------------- block style: P or H1–H6 --

const BLOCK_LABEL = (l: HeadingLevel | 0) => (l ? `Heading ${l}` : 'Paragraph');

function BlockStyle({editor, level}: {editor: Editor; level: HeadingLevel | 0}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const MOD = modKey();
  const ALT = altKey();
  const set = (l: HeadingLevel | 0) => {
    const chain = editor.chain().focus();
    if (l) chain.setHeading({level: l}).run();
    else chain.setParagraph().run();
    setOpen(false);
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="rte-tool rte-block-trigger"
        aria-label={`Text style: ${BLOCK_LABEL(level)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Text style"
        onMouseDown={event => event.preventDefault()}
        onClick={() => setOpen(value => !value)}>
        {BLOCK_LABEL(level)}
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label="Text style" className="rte-block-menu" focusFirst={false}>
        <div role="menu" aria-label="Text style">
          {([0, ...LEVELS] as (HeadingLevel | 0)[]).map(l => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={level === l}
              className="rte-block-item"
              onMouseDown={event => event.preventDefault()}
              onClick={() => set(l)}>
              <span className={`rte-block-preview rte-block-preview-${l}`}>{BLOCK_LABEL(l)}</span>
              <span className="rte-block-key">
                {`${MOD}${ALT}${l}`}
                <Icon name="check" size={14} className={level === l ? '' : 'rte-invisible'} />
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

// --------------------------------------------------- colour and highlight --

function Swatches({
  kind,
  label,
  shortcut,
  icon,
  current,
  colors,
  clearLabel,
  onPick,
  onClear,
}: {
  kind: 'color' | 'highlight';
  label: string;
  shortcut?: string;
  icon: IconName;
  current: string | null;
  colors: readonly {name: string; value: string; className: string}[];
  clearLabel: string;
  onPick: (color: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const same = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
  const swatch = colors.find(c => same(current, c.value));
  return (
    <>
      <span className="rte-swatch-tool" data-current={swatch ? `${kind}-${swatch.className}` : current ? 'other' : undefined}>
        <Tool
          label={label}
          shortcut={shortcut}
          icon={icon}
          expanded={open}
          buttonRef={node => {
            trigger.current = node;
          }}
          onClick={() => setOpen(value => !value)}>
          {/* The colour in use, as a bar under the icon. */}
          <span aria-hidden="true" className={`rte-swatch-bar${swatch ? ` rte-${kind}-${swatch.className}` : ''}`} />
        </Tool>
      </span>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label={label} className="rte-swatches" focusFirst={false}>
        <p className="rte-popover-label">{label}</p>
        <div role="group" aria-label={label} className="rte-swatch-row">
          {colors.map(c => (
            <button
              key={c.value}
              type="button"
              aria-label={c.name}
              aria-pressed={same(current, c.value)}
              title={c.name}
              className={`rte-swatch rte-swatch-${kind} rte-${kind}-${c.className}`}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                onPick(c.value);
                setOpen(false);
              }}>
              {kind === 'highlight' ? <span className="visually-hidden">{c.name}</span> : 'A'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rte-popover-link"
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            onClear();
            setOpen(false);
          }}>
          {clearLabel}
        </button>
      </Popover>
    </>
  );
}

// ------------------------------------------------------------------- link --

/** Link button + panel: add, change or remove the link on the selection. */
function LinkTool({editor, on}: {editor: Editor; on: boolean}) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const inputId = useId();

  const show = () => {
    setHref((editor.getAttributes('link').href as string | undefined) ?? '');
    setError(null);
    setOpen(true);
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setOpen(false);
  };

  const apply = () => {
    const raw = href.trim();
    if (!raw) return remove();
    const url = normalizeHref(raw);
    if (!url) {
      setError('Use a web address, an email address or a path on this site, like /collections/winter.');
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !on) chain.insertContent({type: 'text', text: raw, marks: [{type: 'link', attrs: {href: url}}]}).run();
    else chain.setLink({href: url}).run();
    setOpen(false);
  };

  return (
    <>
      <Tool
        label={on ? 'Edit link' : 'Link'}
        on={on}
        icon="link"
        expanded={open}
        buttonRef={node => {
          trigger.current = node;
        }}
        onClick={() => (open ? setOpen(false) : show())}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label="Link" className="rte-link-panel">
        {/* Not a <form>: the editor usually sits inside a screen's own form. Enter applies. */}
        <div className="field" data-invalid={error ? '' : undefined}>
          <label htmlFor={inputId}>Link address</label>
          <input
            id={inputId}
            value={href}
            placeholder="https://… or /collections/…"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={event => {
              setHref(event.target.value);
              setError(null);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
            }}
          />
          {error && (
            <p className="field-error" id={`${inputId}-error`} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="rte-link-actions">
          {on ? (
            <Button variant="secondary" size="sm" onClick={remove}>
              Remove link
            </Button>
          ) : (
            <span />
          )}
          <Button size="sm" onClick={apply}>
            {on ? 'Update' : 'Add link'}
          </Button>
        </div>
      </Popover>
    </>
  );
}
