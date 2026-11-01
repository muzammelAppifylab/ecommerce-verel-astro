/* Progress of a "Translate missing" run (port of VAREL src/pages/admin/translations/BackfillProgress.tsx). */
import type {BackfillProgress as Progress} from '../../../../lib/types/admin/translations';
import {Button, ProgressBar} from '../../../ui';

export function BackfillProgress({progress: p, onCancel}: {progress: Progress; onCancel?: () => void}) {
  if (!p.running && !p.finished) return null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : p.finished ? 100 : 0;
  const remaining = p.total != null ? p.total - p.done : null;
  const line = p.running
    ? p.total == null
      ? 'Starting translation…'
      : `Translating · ${p.done} of ${p.total}`
    : p.error
      ? `Stopped after ${p.done} ${p.done === 1 ? 'translation' : 'translations'}`
      : p.done === 0
        ? 'Nothing was left to translate'
        : `Translated ${p.done} ${p.done === 1 ? 'field' : 'fields'}${remaining ? ` · ${remaining} left` : ''}`;
  return (
    <div className="card-panel lang-progress" role="status" aria-live="polite">
      <div className="lang-progress-head">
        <span>{line}</span>
        {p.running && onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Stop
          </Button>
        )}
      </div>
      <ProgressBar value={pct} label="Translation progress" />
      {(p.error || p.failed > 0) && (
        <p className="lang-progress-error">{p.error ?? `${p.failed} could not be translated. Check the provider under Setup.`}</p>
      )}
    </div>
  );
}
