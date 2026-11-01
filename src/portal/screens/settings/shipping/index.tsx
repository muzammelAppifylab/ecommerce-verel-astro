import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useMemo, useState} from 'react';

import {money} from '../../../../lib/format';
import type {AdminShippingMethod, AdminShippingZone} from '../../../../lib/types/admin/store';
import {settingsQuery, shippingQuery, useDeleteMethod, useDeleteZone} from '../../../queries/settings';
import {Button, Card, EmptyState, LoadingBlock, PageHeader, useConfirm, useToast} from '../../../ui';
import {currencySymbol, firstProblem, ReadOnlyNote, useCanEditSettings} from '../shared';
import {isCatchAll, MethodModal, ZoneModal} from './dialogs';
import {plural, ZoneCard} from './ZoneCard';

/**
 * Settings · Shipping (port of VAREL `pages/admin/shipping/ShippingPage.tsx`): zones matched by the
 * shipping country, their methods and rates. Not a draft form: every action saves at once.
 */

const byPosition = <T extends {position: number}>(a: T, b: T) => a.position - b.position;

export function ShippingSettings() {
  const canWrite = useCanEditSettings();
  const {data, isLoading, error, refetch} = useQuery(shippingQuery);
  const settings = useQuery(settingsQuery);
  const delZone = useDeleteZone();
  const delMethod = useDeleteMethod();
  const confirm = useConfirm();
  const toast = useToast();

  const [zoneModal, setZoneModal] = useState<{open: boolean; zone: AdminShippingZone | null}>({open: false, zone: null});
  const [methodModal, setMethodModal] = useState<{open: boolean; zone: AdminShippingZone | null; method: AdminShippingMethod | null}>({
    open: false,
    zone: null,
    method: null,
  });

  // Country zones first (by position), the catch-all last.
  const zones = useMemo(() => (data ? [...data].sort((a, b) => Number(isCatchAll(a)) - Number(isCatchAll(b)) || byPosition(a, b)) : undefined), [data]);
  const nextPosition = data?.reduce((m, z) => Math.max(m, z.position + 1), 0) ?? 0;
  const catchAllCount = data?.filter(isCatchAll).length ?? 0;
  const currency = settings.data?.currency ?? 'USD';
  const threshold = settings.data?.freeShippingThreshold;

  const deleteZone = (zone: AdminShippingZone) =>
    void confirm({
      title: `Delete ${zone.zone}`,
      body: `Its ${plural(zone.methods.length, 'method')} ${zone.methods.length === 1 ? 'is' : 'are'} removed too.${
        zone.countries.length ? ' Its countries fall back to the catch-all zone.' : ''
      }`,
      confirmLabel: 'Delete',
      pendingLabel: 'Deleting…',
      action: () => delZone.mutateAsync(zone.id).catch(e => Promise.reject(new Error(firstProblem(e)))),
    }).then(ok => ok && toast.success(`${zone.zone} deleted`));

  const deleteMethod = (zone: AdminShippingZone, method: AdminShippingMethod) =>
    void confirm({
      title: `Delete ${method.name}`,
      body: `Customers in ${zone.zone} can no longer choose it at checkout.`,
      confirmLabel: 'Delete',
      pendingLabel: 'Deleting…',
      action: () => delMethod.mutateAsync(method.id).catch(e => Promise.reject(new Error(firstProblem(e)))),
    }).then(ok => ok && toast.success(`${method.name} deleted`));

  return (
    <div className="app-page">
      <PageHeader
        title="Shipping"
        description="Zones are matched by the shipping country. Methods and rates show at checkout."
        actions={
          canWrite && (
            <Button icon="plus" disabled={isLoading} onClick={() => setZoneModal({open: true, zone: null})}>
              New zone
            </Button>
          )
        }
      />
      {!canWrite && <ReadOnlyNote />}

      <Card>
        <div className="settings-threshold">
          <span>
            <span className="muted">Free-shipping threshold</span>
            <span className="settings-num settings-threshold-value">
              {settings.isLoading ? '…' : threshold != null ? (threshold > 0 ? `Orders over ${money(threshold, currency)}` : 'Off') : '—'}
            </span>
            <span className="muted"> · free-rate methods apply only above it</span>
          </span>
          <Link to="/settings/checkout">{canWrite ? 'Change in settings' : 'View settings'}</Link>
        </div>
      </Card>

      {error && !data ? (
        <Card>
          <EmptyState
            icon="alert"
            title="Shipping could not be loaded"
            action={
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => void refetch()}>
                Try again
              </Button>
            }>
            {firstProblem(error)}
          </EmptyState>
        </Card>
      ) : isLoading || !zones ? (
        <LoadingBlock rows={3} />
      ) : zones.length === 0 ? (
        <Card>
          <EmptyState
            icon="truck"
            title="No shipping zones yet"
            action={
              canWrite && (
                <Button icon="plus" onClick={() => setZoneModal({open: true, zone: null})}>
                  New zone
                </Button>
              )
            }>
            Add one to offer delivery.
          </EmptyState>
        </Card>
      ) : (
        zones.map(z => (
          <ZoneCard
            key={z.id}
            zone={z}
            currency={currency}
            canWrite={canWrite}
            deletable={!isCatchAll(z) || catchAllCount > 1}
            onEdit={() => setZoneModal({open: true, zone: z})}
            onDelete={() => deleteZone(z)}
            onAddMethod={() => setMethodModal({open: true, zone: z, method: null})}
            onEditMethod={m => setMethodModal({open: true, zone: z, method: m})}
            onDeleteMethod={m => deleteMethod(z, m)}
          />
        ))
      )}

      {canWrite && (
        <>
          <ZoneModal open={zoneModal.open} onClose={() => setZoneModal(s => ({...s, open: false}))} zone={zoneModal.zone} nextPosition={nextPosition} />
          <MethodModal
            open={methodModal.open}
            onClose={() => setMethodModal(s => ({...s, open: false}))}
            zone={methodModal.zone}
            method={methodModal.method}
            symbol={currencySymbol(currency)}
          />
        </>
      )}
    </div>
  );
}
