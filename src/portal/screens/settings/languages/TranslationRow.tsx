/* One text in the workspace (VAREL Languages.tsx `Row`, `InlineEdit`, `RowAct`, `Text`), as DataTable cells.
   Short plain texts are edited in the cell; long, formatted or structured ones open the full editor in a drawer
   (VAREL expanded the row). Retranslate and "Undo my edit" ask first when they would replace a manual edit. */
import {useEffect, useRef, useState, type KeyboardEvent} from 'react';

import {isRichField} from '../../../../lib/rich-text';
import type {TranslationRow as Row} from '../../../../lib/types/admin/translations';
import {useRetranslate, useRevertTranslation, useSaveTranslation} from '../../../queries/languages';
import {when} from '../../../shared';
import {Button, Drawer, IconButton, TranslationEditor, fieldLabel, richToPlain, useConfirm, useToast} from '../../../ui';
import {entityLabel, jsonText, languageName, looksJson, STATUS_LABEL} from './labels';

export const rowKey = (r: Row) => `${r.entity}:${r.entityId}:${r.field}:${r.locale}`;

const kind = (r: Row) => {
  const json = looksJson(r.sourceValue);
  const rich = isRichField(r.entity, r.field);
  // Short plain texts are edited right in the cell; long, formatted or structured ones open the full editor.
  const simple = !json && !rich && r.sourceValue.length <= 120 && !r.sourceValue.includes('\n');
  return {json, rich, simple};
};

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? `${fallback}: ${e.message}` : fallback);

/** The "Where" cell: the record and the field. */
export function WhereCell({row: r}: {row: Row}) {
  return (
    <div className="tr-where">
      <p className="tr-where-label" title={r.label}>
        {r.label}
      </p>
      <p className="tr-where-meta">
        {entityLabel(r.entity)} · {fieldLabel(r.field)}
      </p>
    </div>
  );
}

/** The source cell. */
export function SourceCell({row: r}: {row: Row}) {
  const {json, rich} = kind(r);
  return <Text value={rich ? richToPlain(r.sourceValue) : r.sourceValue} json={json} muted />;
}

/** The translation cell: the value (click to edit), its status and when it was written. */
export function TranslationCell({
  row: r,
  canWrite,
  editing,
  disabled,
  onEdit,
  onDone,
}: {
  row: Row;
  canWrite: boolean;
  editing: boolean;
  disabled: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const {json, rich, simple} = kind(r);
  const save = useSaveTranslation();
  const toast = useToast();
  const shown = rich && r.value ? richToPlain(r.value) : r.value;

  const onSave = (value: string) =>
    save.mutate(
      {entity: r.entity, entityId: r.entityId, field: r.field, locale: r.locale, value},
      {
        onSuccess: () => {
          onDone();
          toast.success('Translation saved');
        },
        onError: e => toast.danger(errorText(e, 'The translation could not be saved')),
      }
    );

  return (
    <div className="tr-cell">
      {editing && simple ? (
        <InlineEdit initial={r.value ?? ''} saving={save.isPending} onSave={onSave} onCancel={onDone} />
      ) : canWrite ? (
        <button type="button" className="tr-value-button" title="Edit translation" disabled={disabled} onClick={onEdit}>
          <Text value={shown} json={json} />
        </button>
      ) : (
        <Text value={shown} json={json} />
      )}
      <p className={`tr-status tr-status-${r.status}`}>
        {STATUS_LABEL[r.status]}
        {r.updatedAt && <span className="tr-status-when"> · {when(r.updatedAt)}</span>}
      </p>
      {!simple && (
        <Drawer
          open={editing}
          onClose={() => !save.isPending && onDone()}
          dismissible={!save.isPending}
          title={`${r.label} · ${fieldLabel(r.field)} · ${languageName(r.locale)}`}
          description={`${entityLabel(r.entity)}. The ${languageName(r.locale)} text customers see.`}>
          {editing && (
            <TranslationEditor
              field={{field: r.field, sourceValue: r.sourceValue, json}}
              rich={rich}
              initial={r.value ?? ''}
              saving={save.isPending}
              onCancel={onDone}
              onSave={onSave}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}

/** The row's actions: retranslate, and undo a manual edit. Only the acted-on row shows pending. */
export function RowActions({
  row: r,
  busy,
  disabled,
  onBusy,
}: {
  row: Row;
  busy: boolean;
  disabled: boolean;
  onBusy: (key: string | null) => void;
}) {
  const retranslate = useRetranslate();
  const revert = useRevertTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const target = {entity: r.entity, entityId: r.entityId, field: r.field, locale: r.locale};
  const manual = r.origin === 'manual';

  const run = async (kindOf: 'retranslate' | 'revert') => {
    if (manual) {
      const ok = await confirm(
        kindOf === 'retranslate'
          ? {title: 'Replace your edit with a machine translation?', body: 'Your edited text is replaced by a new automatic translation.', confirmLabel: 'Retranslate'}
          : {title: 'Undo your edit?', body: 'The automatic translation replaces it.', confirmLabel: 'Undo my edit'}
      );
      if (!ok) return;
    }
    onBusy(rowKey(r));
    const m = kindOf === 'retranslate' ? retranslate : revert;
    m.mutate(target, {
      onSuccess: () => toast.success(kindOf === 'retranslate' ? 'Retranslated' : 'Back to the automatic translation'),
      onError: e => toast.danger(errorText(e, kindOf === 'retranslate' ? 'This could not be retranslated' : 'This could not be reverted')),
      onSettled: () => onBusy(null),
    });
  };

  return (
    <div className="tr-actions-cell">
      <IconButton
        icon="refresh"
        label="Retranslate"
        size="sm"
        pending={busy && retranslate.isPending}
        disabled={disabled || (busy && !retranslate.isPending)}
        onClick={() => void run('retranslate')}
      />
      {manual && (
        <IconButton
          icon="rotate-ccw"
          label="Undo my edit (back to automatic)"
          size="sm"
          pending={busy && revert.isPending}
          disabled={disabled || (busy && !revert.isPending)}
          onClick={() => void run('revert')}
        />
      )}
    </div>
  );
}

function InlineEdit({initial, saving, onSave, onCancel}: {initial: string; saving: boolean; onSave: (v: string) => void; onCancel: () => void}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (v.trim() && !saving) onSave(v);
    } else if (e.key === 'Escape' && !saving) {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="tr-inline">
      <input ref={ref} aria-label="Translation" className="tr-input" value={v} readOnly={saving} onChange={e => setV(e.target.value)} onKeyDown={onKey} />
      <div className="tr-inline-actions">
        <Button size="sm" pending={saving} pendingLabel="Saving…" disabled={!v.trim()} onClick={() => onSave(v)}>
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <span className="tr-inline-hint">Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}

/** Up to three lines; structured values show their text only. */
function Text({value, json, muted}: {value: string | null; json: boolean; muted?: boolean}) {
  const shown = value == null ? null : json ? jsonText(value) : value;
  return (
    <span className={muted ? 'tr-text tr-text-muted' : 'tr-text'}>{shown || <span className="tr-empty">Not translated yet</span>}</span>
  );
}
