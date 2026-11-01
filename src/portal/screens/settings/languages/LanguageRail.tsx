/* The language rail (VAREL Languages.tsx `LanguageRail`): the source language, one card per target language with
   its coverage, and "Add a language" for people who may change the store's languages. */
import type {TranslationsStatus} from '../../../../lib/types/admin/translations';
import {Icon, ProgressBar, Skeleton} from '../../../ui';
import {languageName, pct, todo} from './labels';

export function LanguageRail({
  status: s,
  loading,
  selected,
  canAdd,
  onSelect,
  onAdd,
}: {
  status?: TranslationsStatus;
  loading: boolean;
  selected?: string;
  canAdd: boolean;
  onSelect: (locale: string) => void;
  onAdd: () => void;
}) {
  if (loading || !s)
    return (
      <div className="lang-rail" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="lang-card lang-card-skeleton">
            <Skeleton lines={3} />
          </div>
        ))}
      </div>
    );
  const targets = s.locales.filter(l => l !== s.defaultLocale);
  return (
    <div className="lang-rail" role="tablist" aria-label="Language">
      <div className="lang-card lang-card-source">
        <span className="lang-card-name">{languageName(s.defaultLocale)}</span>
        <span className="lang-card-meta">Source · written in</span>
      </div>
      {targets.map(l => {
        const c = s.totals[l];
        const left = todo(c);
        const name = languageName(l);
        return (
          <button key={l} type="button" role="tab" aria-selected={l === selected} className="lang-card" onClick={() => onSelect(l)}>
            <span className="lang-card-top">
              <span className="lang-card-name">{name}</span>
              <code className="lang-card-code">{l}</code>
            </span>
            <ProgressBar value={pct(c)} label={`${name} translated`} />
            <span className="lang-card-foot">
              <span className="lang-card-pct">{pct(c)}%</span>
              {left > 0 ? (
                <span className="lang-card-todo">{left} to do</span>
              ) : (
                <span className="lang-card-done">
                  <Icon name="check" size={14} />
                  Done
                </span>
              )}
            </span>
          </button>
        );
      })}
      {canAdd && (
        <button type="button" className="lang-card lang-card-add" onClick={onAdd}>
          <Icon name="plus" size={16} />
          Add a language
        </button>
      )}
    </div>
  );
}
