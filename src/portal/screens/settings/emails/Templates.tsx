import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode} from 'react';

import type {AdminEmailTemplate, EmailVars} from '../../../../lib/types/admin/emails';
import {ApiError, hasAbility} from '../../../api';
import {
  emailDeliveryQuery,
  emailPreviewQuery,
  emailTemplatesQuery,
  resetEmailTemplate,
  sendTestEmail,
  updateEmailTemplate,
  type EmailsSearch,
} from '../../../queries/emails';
import {useMe} from '../../../shared';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Icon,
  IconButton,
  type IconName,
  Menu,
  Modal,
  Notice,
  Popover,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  Switch,
  useConfirm,
  useToast,
} from '../../../ui';
import {EmailFrame} from './EmailFrame';
import {formatDateTime, PROVIDER_LABEL, STATUS_LABEL} from './labels';

/*
 * Templates: a picker across the top, then the editor (subject, a formatting toolbar over the body, sample data)
 * beside a live preview of the branded email. Customer templates are translated in Settings · Languages.
 * WP-22: port of VAREL src/pages/admin/emails/Templates.tsx (components swapped per PLAN.md §6).
 */

const AUDIENCES: {id: AdminEmailTemplate['audience']; label: string}[] = [
  {id: 'customer', label: 'To customers'},
  {id: 'staff', label: 'To the studio'},
];

const problemOf = (err: unknown) => (err instanceof Error ? err.message : 'That did not work. Try again.');

export function Templates({search, set}: {search: EmailsSearch; set: (p: Partial<EmailsSearch>) => void}) {
  const {data, isLoading, error, refetch, isRefetching} = useQuery(emailTemplatesQuery);
  const current = data?.find(t => t.key === search.key) ?? data?.[0];
  const dirtyRef = useRef(false);
  const confirm = useConfirm();

  const choose = async (key: string) => {
    if (key === current?.key) return;
    if (dirtyRef.current) {
      const ok = await confirm({
        title: 'Discard your changes?',
        body: 'Your edits to this template have not been saved.',
        confirmLabel: 'Discard changes',
        tone: 'danger',
      });
      if (!ok) return;
      dirtyRef.current = false;
    }
    set({key});
  };

  if (error) {
    return (
      <div className="emails-error">
        <ErrorNote error={error} title="Templates could not be loaded" />
        <Button variant="secondary" size="sm" pending={isRefetching} pendingLabel="Trying again…" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (isLoading || !data || !current) {
    return (
      <div className="emails-loading" role="status">
        <span className="visually-hidden">Loading…</span>
        <Skeleton lines={2} />
        <div className="emails-editor-grid">
          <div className="emails-skeleton-pane" />
          <div className="emails-skeleton-pane" />
        </div>
      </div>
    );
  }

  return (
    <Editor
      key={current.key}
      template={current}
      picker={<TemplatePicker templates={data} current={current} onChoose={key => void choose(key)} />}
      onDirty={d => (dirtyRef.current = d)}
    />
  );
}

/* ---------- Picker ---------- */

function Dot({on}: {on: boolean}) {
  return <span aria-hidden="true" className={on ? 'emails-dot emails-dot-on' : 'emails-dot'} />;
}

/** The template name doubles as the switcher: one click lists every template, grouped by who receives it. */
function TemplatePicker({templates, current, onChoose}: {templates: AdminEmailTemplate[]; current: AdminEmailTemplate; onChoose: (key: string) => void}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="emails-picker-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        <span className="emails-picker-name">{current.name}</span>
        <Icon name="chevron-down" size={16} className={open ? 'emails-chevron emails-chevron-open' : 'emails-chevron'} />
        <span className="visually-hidden">Choose another template</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label="Choose a template" className="emails-picker">
        {AUDIENCES.map(a => (
          <div key={a.id} className="emails-picker-group" role="group" aria-label={a.label}>
            <p className="emails-picker-label">{a.label}</p>
            {templates
              .filter(t => t.audience === a.id)
              .map(t => (
                <button
                  key={t.key}
                  type="button"
                  className="emails-picker-item"
                  aria-current={t.key === current.key || undefined}
                  onClick={() => {
                    setOpen(false);
                    onChoose(t.key);
                  }}>
                  <Dot on={t.enabled} />
                  <span className="emails-picker-item-name">{t.name}</span>
                  {!t.enabled ? <span className="emails-muted">Off</span> : t.customised ? <span className="emails-muted">Edited</span> : null}
                  {t.key === current.key && <Icon name="check" size={14} />}
                </button>
              ))}
          </div>
        ))}
      </Popover>
    </>
  );
}

/* ---------- Body formatting ---------- */

type Snippet = 'heading' | 'bold' | 'button' | 'note' | 'row' | 'divider';

// Icons: nearest kit names until F5 adds heading, mouse-pointer-click, rows-3, separator-horizontal (Request R6).
const SNIPPETS: {id: Snippet; label: string; hint: string; icon: IconName}[] = [
  {id: 'heading', label: 'Heading', hint: '# Heading', icon: 'baseline'},
  {id: 'bold', label: 'Bold', hint: '**bold**', icon: 'bold'},
  {id: 'button', label: 'Button', hint: '[Label](link)', icon: 'link'},
  {id: 'note', label: 'Quiet note', hint: '> note', icon: 'quote'},
  {id: 'row', label: 'Summary row', hint: 'Label | value', icon: 'list'},
  {id: 'divider', label: 'Divider', hint: '---', icon: 'minus'},
];

/** Inserts a snippet at the selection. Block snippets get their own line; the placeholder text comes back selected. */
export function applySnippet(value: string, start: number, end: number, kind: Snippet) {
  const sel = value.slice(start, end);
  let text: string;
  let pick: [number, number];
  switch (kind) {
    case 'bold':
      text = `**${sel || 'bold text'}**`;
      pick = [2, text.length - 2];
      break;
    case 'heading':
      text = `# ${sel || 'A heading'}`;
      pick = [2, text.length];
      break;
    case 'note':
      text = `> ${sel || 'A quieter line, set in grey'}`;
      pick = [2, text.length];
      break;
    case 'button': {
      const label = sel || 'View your order';
      text = `[${label}](https://)`;
      pick = [label.length + 3, text.length - 1];
      break;
    }
    case 'row':
      text = `${sel || 'Label'} | value`;
      pick = [0, (sel || 'Label').length];
      break;
    case 'divider':
      text = '---';
      pick = [3, 3];
  }
  const inline = kind === 'bold';
  const before = !inline && start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const after = !inline && end < value.length && value[end] !== '\n' ? '\n' : '';
  const next = value.slice(0, start) + before + text + after + value.slice(end);
  const at = start + before.length;
  return {value: next, select: [at + pick[0], at + pick[1]] as const};
}

/* ---------- Editor ---------- */

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const pretty = (v: EmailVars) => JSON.stringify(v, null, 2);

export function parseVars(text: string): {vars: EmailVars | null; error: string | null} {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {vars: null, error: 'Sample data must be a JSON object, e.g. { "firstName": "Mira" }'};
    return {vars: v as EmailVars, error: null};
  } catch (e) {
    return {vars: null, error: `Not valid JSON: ${(e as Error).message}`};
  }
}

function Editor({template: t, picker, onDirty}: {template: AdminEmailTemplate; picker: ReactNode; onDirty: (dirty: boolean) => void}) {
  const qc = useQueryClient();
  const me = useMe().data;
  const canWrite = hasAbility(me?.abilities, 'manageStoreSettings');
  const delivery = useQuery(emailDeliveryQuery).data;
  const toast = useToast();
  const confirm = useConfirm();

  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [sampleText, setSampleText] = useState(() => pretty(t.sample));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<'desktop' | 'mobile'>('desktop');
  const [format, setFormat] = useState<'html' | 'text'>('html');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastField = useRef<'subject' | 'body'>('body');

  // Follow the server copy after a save or a restore.
  useEffect(() => {
    setSubject(t.subject);
    setBody(t.body);
  }, [t.subject, t.body]);

  const dirty = subject !== t.subject || body !== t.body;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sample = useMemo(() => parseVars(sampleText), [sampleText]);
  const draft = useDebounced(useMemo(() => (sample.vars ? {subject, body, vars: sample.vars} : null), [subject, body, sample.vars]), 300);
  const preview = useQuery(emailPreviewQuery(t.key, draft));

  const focusRange = (el: HTMLInputElement | HTMLTextAreaElement | null, a: number, b: number) =>
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a, b);
    });

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    const target = lastField.current === 'subject' ? subjectRef.current : bodyRef.current;
    const value = lastField.current === 'subject' ? subject : body;
    const setValue = lastField.current === 'subject' ? setSubject : setBody;
    const start = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + token + value.slice(end));
    focusRange(target, start + token.length, start + token.length);
  };

  const applyFormat = (kind: Snippet) => {
    const el = bodyRef.current;
    const r = applySnippet(body, el?.selectionStart ?? body.length, el?.selectionEnd ?? body.length, kind);
    setBody(r.value);
    lastField.current = 'body';
    focusRange(el, r.select[0], r.select[1]);
  };

  async function save() {
    const e: Record<string, string> = {};
    if (!subject.trim()) e.subject = 'Enter a subject.';
    if (!body.trim()) e.body = 'Enter the email body.';
    setErrors(e);
    if (Object.keys(e).length) {
      (e.subject ? subjectRef.current : bodyRef.current)?.focus();
      return;
    }
    setSaving(true);
    try {
      await updateEmailTemplate(qc, t.key, {subject, body});
      toast.success('Template saved');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      toast.danger(problemOf(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(enabled: boolean) {
    setToggling(true);
    try {
      await updateEmailTemplate(qc, t.key, {enabled});
      toast.success(enabled ? `${t.name} turned on` : `${t.name} turned off. It will be logged as skipped`);
    } catch (err) {
      toast.danger(problemOf(err));
    } finally {
      setToggling(false);
    }
  }

  async function sendTest(event?: FormEvent) {
    event?.preventDefault();
    if (!sample.vars) {
      setTestError('Fix the sample data first.');
      return;
    }
    const to = testTo.trim();
    if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setTestError('Enter a valid email address, or leave it empty.');
      return;
    }
    setTestError(null);
    setTesting(true);
    try {
      const m = await sendTestEmail(qc, t.key, {to: to || undefined, subject, body, vars: sample.vars});
      setTestOpen(false);
      if (m.status === 'failed') toast.danger(`Test email failed: ${m.error ?? 'unknown error'}`);
      else toast.success(m.status === 'stored' ? `Test email saved to the outbox for ${m.to}` : `Test email ${STATUS_LABEL[m.status].toLowerCase()} to ${m.to}`);
    } catch (err) {
      setTestError(err instanceof ApiError && err.fields.to ? err.fields.to : problemOf(err));
    } finally {
      setTesting(false);
    }
  }

  const restore = () =>
    void confirm({
      title: 'Restore the default template?',
      body: 'The subject and message go back to the VAREL default. Your edits are replaced.',
      confirmLabel: 'Restore default',
      pendingLabel: 'Restoring…',
      tone: 'danger',
      action: () => resetEmailTemplate(qc, t.key),
    }).then(ok => {
      if (ok) {
        setErrors({});
        toast.success('Default template restored');
      }
    });

  const provider = delivery?.emailProvider ?? 'outbox';
  const warnings = [
    preview.data?.problem,
    preview.data?.unknown.length ? `Not a variable for this template: ${preview.data.unknown.map(n => `{{${n}}}`).join(', ')}` : null,
  ].filter(Boolean);

  return (
    <div className="emails-editor">
      {/* Which template, who gets it, and whether it is sent at all */}
      <div className="emails-editor-head">
        <div className="emails-editor-title">
          {picker}
          <p className="emails-description">{t.description}</p>
          <p className="emails-meta">
            {t.audience === 'customer' ? 'To customers' : 'To the studio'} ·{' '}
            {t.stats.lastAt ? `last sent ${formatDateTime(t.stats.lastAt)} · ${t.stats.sent} sent` : 'not sent yet'}
            {t.stats.failed > 0 && <span className="emails-text-danger"> · {t.stats.failed} failed</span>}
            {t.customised && ' · edited'}
          </p>
        </div>
        <div className="emails-sending">
          <Dot on={t.enabled} />
          <Switch label={t.enabled ? 'Sending' : 'Not sending'} checked={t.enabled} onChange={on => void toggle(on)} disabled={!canWrite} pending={toggling} />
        </div>
      </div>

      <div className="emails-editor-grid">
        {/* Left: write */}
        <div className="emails-write">
          <Field label="Subject" id="tpl-subject" error={errors.subject}>
            <input
              id="tpl-subject"
              ref={subjectRef}
              value={subject}
              readOnly={!canWrite}
              onFocus={() => (lastField.current = 'subject')}
              onChange={e => {
                setSubject(e.target.value);
                if (errors.subject) setErrors(({subject: _s, ...rest}) => rest);
              }}
              aria-invalid={errors.subject ? true : undefined}
              aria-describedby={errors.subject ? 'tpl-subject-error' : undefined}
              maxLength={200}
            />
          </Field>

          <div className="field emails-body-field" data-invalid={errors.body ? '' : undefined}>
            <label htmlFor="tpl-body">Message</label>
            <div className="emails-body-box">
              {canWrite && (
                <div role="toolbar" aria-label="Formatting" className="emails-toolbar">
                  {SNIPPETS.map((s, i) => (
                    <span key={s.id} className="emails-toolbar-item">
                      {(i === 2 || i === 5) && <span aria-hidden="true" className="emails-toolbar-sep" />}
                      <IconButton
                        icon={s.icon}
                        label={`${s.label} · ${s.hint}`}
                        size="sm"
                        onMouseDown={e => e.preventDefault()} // keep the textarea selection
                        onClick={() => applyFormat(s.id)}
                      />
                    </span>
                  ))}
                  <span aria-hidden="true" className="emails-toolbar-sep" />
                  <Menu
                    label="Insert variable"
                    align="start"
                    trigger={
                      <span className="emails-insert-trigger">
                        <Icon name="plus" size={16} />
                        Insert variable
                        <Icon name="chevron-down" size={14} />
                      </span>
                    }
                    items={t.variables.map(v => ({
                      label: v.description ? `{{${v.name}}} · ${v.description}` : `{{${v.name}}}`,
                      onSelect: () => insertVariable(v.name),
                    }))}
                  />
                </div>
              )}
              <textarea
                id="tpl-body"
                ref={bodyRef}
                rows={22}
                spellCheck
                className="emails-body"
                value={body}
                readOnly={!canWrite}
                onFocus={() => (lastField.current = 'body')}
                onChange={e => {
                  setBody(e.target.value);
                  if (errors.body) setErrors(({body: _b, ...rest}) => rest);
                }}
                aria-invalid={errors.body ? true : undefined}
                aria-describedby={errors.body ? 'tpl-body-error' : 'tpl-body-hint'}
              />
            </div>
            {errors.body ? (
              <p className="field-error" id="tpl-body-error" role="alert">
                {errors.body}
              </p>
            ) : (
              <p className="field-hint" id="tpl-body-hint">
                Plain lines become paragraphs. Use the toolbar for headings, buttons, notes and summary rows; <code>{'{{#items}}…{{/items}}'}</code>{' '}
                repeats a row per item.
              </p>
            )}
          </div>

          {warnings.length > 0 && <Notice tone="warning">{warnings.join(' · ')}</Notice>}

          <details className="emails-sample">
            <summary>
              <span>
                Sample data <span className="emails-muted">· used for the preview and test emails</span>
              </span>
              <Icon name="chevron-down" size={16} className="emails-chevron" />
            </summary>
            <div className="emails-sample-body">
              <Field label="Values (JSON)" id="tpl-sample" error={sample.error ?? undefined}>
                <textarea
                  id="tpl-sample"
                  rows={12}
                  className="emails-mono"
                  value={sampleText}
                  onChange={e => setSampleText(e.target.value)}
                  aria-invalid={sample.error ? true : undefined}
                  aria-describedby={sample.error ? 'tpl-sample-error' : undefined}
                  spellCheck={false}
                />
              </Field>
              <Button variant="link" size="sm" onClick={() => setSampleText(pretty(t.sample))}>
                Reset sample data
              </Button>
            </div>
          </details>

          {canWrite && (
            <div className="emails-actions">
              <Button size="sm" onClick={() => void save()} disabled={!dirty} pending={saving} pendingLabel="Saving…">
                Save template
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!dirty || saving}
                onClick={() => {
                  setSubject(t.subject);
                  setBody(t.body);
                  setErrors({});
                }}>
                Discard
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon="mail"
                onClick={() => {
                  setTestError(null);
                  setTestOpen(true);
                }}>
                Send test
              </Button>
              {t.customised && (
                <Button variant="ghost" size="sm" icon="rotate-ccw" className="emails-actions-end" onClick={restore}>
                  Restore default
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Right: see it as the customer will */}
        <div className="emails-preview">
          <div className="emails-preview-bar">
            <p className="emails-muted" aria-live="polite">
              Preview {preview.isFetching && <span>· updating</span>}
            </p>
            <div className="emails-preview-controls">
              <SegmentedControl
                label="Preview format"
                value={format}
                onChange={setFormat}
                options={[
                  {value: 'html', label: 'Designed'},
                  {value: 'text', label: 'Plain text'},
                ]}
              />
              <span className="emails-width-toggle">
                <SegmentedControl
                  label="Preview width"
                  value={view}
                  onChange={setView}
                  options={[
                    {value: 'desktop', label: <Icon name="monitor" size={16} />},
                    {value: 'mobile', label: <Icon name="phone" size={16} />},
                  ]}
                />
              </span>
            </div>
          </div>
          <Card flush className="emails-preview-card">
            <dl className="emails-preview-meta">
              <dt>From</dt>
              <dd>
                {delivery ? `${delivery.emailFromName} <${delivery.emailFromAddress}>` : '…'}
                <span className="emails-muted"> · {PROVIDER_LABEL[provider]}</span>
              </dd>
              <dt>Subject</dt>
              <dd>{preview.data?.subject ?? '…'}</dd>
            </dl>
            {preview.error ? (
              <p role="alert" className="emails-preview-error">
                {preview.error.message}
              </p>
            ) : !preview.data ? (
              <div className="emails-skeleton-frame" aria-hidden="true" />
            ) : format === 'text' ? (
              <pre className="emails-text">{preview.data.text}</pre>
            ) : (
              <div className={view === 'mobile' ? 'emails-frame-wrap emails-frame-phone' : 'emails-frame-wrap'}>
                <div className="emails-frame-inner">
                  <EmailFrame html={preview.data.html} title={`Preview of ${t.name}`} />
                </div>
              </div>
            )}
          </Card>
          {!sample.error && provider === 'outbox' && (
            <p className="emails-note">The store uses the outbox, so test emails are saved there instead of delivered.</p>
          )}
        </div>
      </div>

      <Modal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        dismissible={!testing}
        title="Send a test email"
        description="Sends this template with the sample data, including unsaved edits."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTestOpen(false)} disabled={testing}>
              Cancel
            </Button>
            <Button type="submit" form="tpl-test-form" pending={testing} pendingLabel="Sending…">
              Send test
            </Button>
          </>
        }>
        <form id="tpl-test-form" noValidate onSubmit={e => void sendTest(e)} className="emails-test-form">
          <Field label="Send to" id="tpl-test-to" hint={`Leave empty to send to ${me?.viewer.email ?? 'yourself'}`} error={testError ?? undefined}>
            <input
              id="tpl-test-to"
              type="email"
              autoComplete="email"
              placeholder={me?.viewer.email ?? undefined}
              value={testTo}
              onChange={e => setTestTo(e.target.value)}
              aria-invalid={testError ? true : undefined}
              aria-describedby={testError ? 'tpl-test-to-error' : 'tpl-test-to-hint'}
            />
          </Field>
          <p className="emails-note">
            {provider === 'outbox' ? (
              'The outbox is on, so the test is saved there and not delivered.'
            ) : (
              <>
                Delivered through <StatusBadge tone="info">{PROVIDER_LABEL[provider]}</StatusBadge>. The subject starts with [Test].
              </>
            )}
          </p>
        </form>
      </Modal>
    </div>
  );
}
