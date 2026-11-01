import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import type {StoreSettings} from '../../../lib/types/admin/store';
import {hasAbility} from '../../api';
import {reviewSettingsQuery, updateReviewSettings} from '../../queries/reviews';
import {useMe} from '../../shared';
import {Card, Skeleton, Switch, useToast} from '../../ui';

/** The two review settings above the queue (VAREL `Reviews.tsx` `ReviewSettings`; also on WP-23's privacy screen). */

type Key = keyof Pick<StoreSettings, 'reviewsEnabled' | 'reviewsRequireApproval'>;

const TOGGLES: {key: Key; label: string; hint: string}[] = [
  {key: 'reviewsEnabled', label: 'Accept reviews', hint: 'Customers who bought a piece can review it on its page'},
  {key: 'reviewsRequireApproval', label: 'Approve before publishing', hint: 'New reviews wait in this queue'},
];

export function ReviewSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const canEdit = hasAbility(me.data?.abilities, 'manageStoreSettings');
  const settings = useQuery(reviewSettingsQuery);
  const [saving, setSaving] = useState<Key | null>(null);
  const update = useMutation({
    mutationFn: updateReviewSettings,
    onSuccess: next => queryClient.setQueryData(reviewSettingsQuery.queryKey, next),
    onSettled: () => queryClient.invalidateQueries({queryKey: reviewSettingsQuery.queryKey}),
  });
  const s = settings.data;

  const change = async (key: Key, label: string, on: boolean) => {
    setSaving(key);
    try {
      await update.mutateAsync({[key]: on});
      toast.success(`${label} ${on ? 'on' : 'off'}`);
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card as="div" className="review-settings">
      <div className="review-settings-grid" role="group" aria-label="Review settings">
        {TOGGLES.map(t =>
          s ? (
            <Switch
              key={t.key}
              label={t.label}
              description={t.hint}
              checked={Boolean(s[t.key])}
              pending={saving === t.key}
              disabled={!canEdit || (saving !== null && saving !== t.key) || (t.key !== 'reviewsEnabled' && !s.reviewsEnabled)}
              onChange={on => void change(t.key, t.label, on)}
            />
          ) : (
            <div key={t.key} className="switch-row">
              <span className="switch-text">
                <span className="switch-label">{t.label}</span>
                <span className="switch-description">{t.hint}</span>
              </span>
              {settings.isError ? <span className="muted">Unavailable</span> : <Skeleton width="third" />}
            </div>
          )
        )}
      </div>
    </Card>
  );
}
