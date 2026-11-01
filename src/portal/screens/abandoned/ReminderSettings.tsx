import {Card, Select, Switch} from '../../ui';
import {hourOptions} from './format';

/** The "Reminder emails" panel: on / off and the idle time (Setting.abandonedCart*). */
export function ReminderSettings({
  settings,
  canEdit,
  pending,
  onChange,
}: {
  settings: {enabled: boolean; hours: number} | undefined;
  canEdit: boolean;
  pending: boolean;
  onChange: (body: {abandonedCartEnabled?: boolean; abandonedCartHours?: number}, done: string) => void;
}) {
  const off = !settings || !canEdit;
  return (
    <Card title="Reminder emails">
      <div className="ab-settings">
        <Switch
          label="Send abandoned-bag reminders"
          checked={!!settings?.enabled}
          disabled={off}
          pending={pending}
          onChange={v => onChange({abandonedCartEnabled: v}, v ? 'Reminders are on' : 'Reminders are off')}
        />
        <label className="ab-hours">
          <span className="ab-hours-label">Send when a bag is idle</span>
          <Select
            value={settings ? String(settings.hours) : ''}
            options={settings ? hourOptions(settings.hours) : [{value: '', label: 'Loading…'}]}
            disabled={off || pending}
            aria-busy={pending || undefined}
            onChange={e => onChange({abandonedCartHours: Number(e.target.value)}, 'Reminder timing saved')}
          />
        </label>
        <p className="ab-settings-note">
          {!canEdit
            ? 'Only staff with the settings permission can change these.'
            : settings?.enabled
              ? 'Checked every 15 minutes. One reminder per shopper.'
              : 'Off. No reminders are sent until you turn this on.'}
        </p>
      </div>
    </Card>
  );
}
