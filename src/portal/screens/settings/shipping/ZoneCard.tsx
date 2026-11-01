import {useState} from 'react';

import {money} from '../../../../lib/format';
import type {AdminShippingMethod, AdminShippingZone} from '../../../../lib/types/admin/store';
import {useUpdateMethod, useUpdateZone} from '../../../queries/settings';
import {Button, Card, type Column, DataTable, IconButton, Menu, StatusBadge, useToast} from '../../../ui';
import {firstProblem} from '../shared';
import {CountryChips} from './CountryChips';
import {isCatchAll} from './dialogs';

/** One shipping zone: its countries (chips, saved at once) and its methods (port of VAREL `ZonePanel` in `ShippingPage.tsx`). */

const byPosition = <T extends {position: number}>(a: T, b: T) => a.position - b.position;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ZoneCard({
  zone,
  currency,
  canWrite,
  deletable,
  onEdit,
  onDelete,
  onAddMethod,
  onEditMethod,
  onDeleteMethod,
}: {
  zone: AdminShippingZone;
  currency: string;
  canWrite: boolean;
  /** false for the last catch-all zone: the API keeps one so every address can be shipped to */
  deletable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddMethod: () => void;
  onEditMethod: (m: AdminShippingMethod) => void;
  onDeleteMethod: (m: AdminShippingMethod) => void;
}) {
  const updateZone = useUpdateZone();
  const updateMethod = useUpdateMethod();
  const toast = useToast();
  const [chipError, setChipError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const catchAll = isCatchAll(zone);
  const methods = [...zone.methods].sort(byPosition);

  function setCountries(next: string[]) {
    if (next.length === 0) {
      setChipError('A zone needs at least one country. Edit the zone to make it the catch-all.');
      return;
    }
    setChipError(null);
    const added = next.filter(c => !zone.countries.includes(c));
    const removed = zone.countries.filter(c => !next.includes(c));
    updateZone.mutate(
      {id: zone.id, countries: next},
      {
        onSuccess: () => toast.success(added.length ? `${added.join(', ')} added to ${zone.zone}` : `${removed.join(', ')} removed from ${zone.zone}`),
        onError: e => setChipError(firstProblem(e)),
      }
    );
  }

  /** Swap with the neighbour, then save every method whose position changed. */
  async function move(index: number, dir: -1 | 1) {
    const order = [...methods];
    const j = index + dir;
    if (j < 0 || j >= order.length || moving) return;
    [order[index], order[j]] = [order[j]!, order[index]!];
    setMoving(order[j]!.id);
    try {
      await Promise.all(order.map((m, i) => (m.position === i ? null : updateMethod.mutateAsync({id: m.id, position: i}))).filter(Boolean));
    } catch (e) {
      toast.danger(firstProblem(e));
    } finally {
      setMoving(null);
    }
  }

  const summary = `${catchAll ? 'Everywhere else' : plural(zone.countries.length, 'country', 'countries')} · ${plural(methods.length, 'method')}`;

  const columns: Column<AdminShippingMethod>[] = [
    ...(canWrite
      ? [
          {
            key: 'order',
            header: 'Order',
            width: 'shrink' as const,
            cell: (m: AdminShippingMethod) => {
              const i = methods.indexOf(m);
              return (
                <span className="settings-inline">
                  <IconButton icon="chevron-up" size="sm" label={`Move ${m.name} up`} disabled={i === 0 || !!moving} onClick={() => void move(i, -1)} />
                  <IconButton
                    icon="chevron-down"
                    size="sm"
                    label={`Move ${m.name} down`}
                    disabled={i === methods.length - 1 || !!moving}
                    onClick={() => void move(i, 1)}
                  />
                </span>
              );
            },
          },
        ]
      : []),
    {key: 'name', header: 'Method', cell: m => m.name},
    {key: 'detail', header: 'Detail', cell: m => <span className="muted">{m.detail || '—'}</span>},
    {
      key: 'rate',
      header: 'Rate',
      align: 'end',
      cell: m => (m.rate === 0 ? <StatusBadge tone="success">Free</StatusBadge> : <span className="settings-num">{money(m.rate, currency)}</span>),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: 'Actions',
            actions: true,
            cell: (m: AdminShippingMethod) => {
              const i = methods.indexOf(m);
              return (
                <Menu
                  label={`Actions for ${m.name}`}
                  disabled={!!moving}
                  items={[
                    {label: 'Edit method', icon: 'pencil', onSelect: () => onEditMethod(m)},
                    {label: 'Move up', icon: 'chevron-up', disabled: i === 0, onSelect: () => void move(i, -1)},
                    {label: 'Move down', icon: 'chevron-down', disabled: i === methods.length - 1, onSelect: () => void move(i, 1)},
                    'separator',
                    {label: 'Delete…', icon: 'trash', danger: true, onSelect: () => onDeleteMethod(m)},
                  ]}
                />
              );
            },
          },
        ]
      : []),
  ];

  return (
    <Card
      flush
      title={zone.zone}
      description={summary}
      actions={
        canWrite && (
          <Menu
            label={`Actions for ${zone.zone}`}
            items={[
              {label: 'Edit zone', icon: 'pencil', onSelect: onEdit},
              {label: 'Add method', icon: 'plus', onSelect: onAddMethod},
              'separator',
              {label: deletable ? 'Delete zone…' : 'Keep one catch-all zone', icon: 'trash', danger: true, disabled: !deletable, onSelect: onDelete},
            ]}
          />
        )
      }
      footer={
        canWrite && (
          <Button variant="ghost" size="sm" icon="plus" onClick={onAddMethod}>
            Add method
          </Button>
        )
      }>
      <div className="settings-zone-countries">
        <p className="settings-label">Countries</p>
        {catchAll ? (
          <p className="muted">Any country not listed in another zone.</p>
        ) : (
          <CountryChips value={zone.countries} onChange={setCountries} editable={canWrite} disabled={updateZone.isPending} />
        )}
        {chipError && (
          <p className="field-error" role="alert">
            {chipError}
          </p>
        )}
      </div>
      <DataTable
        caption={`${zone.zone} methods`}
        columns={columns}
        rows={methods}
        rowKey={m => m.id}
        busyKey={moving}
        empty={
          <p className="settings-zone-empty muted">
            No methods. Customers in this zone cannot check out physical items.
            {canWrite && (
              <>
                {' '}
                <Button variant="link" size="sm" onClick={onAddMethod}>
                  Add one
                </Button>
              </>
            )}
          </p>
        }
      />
    </Card>
  );
}
