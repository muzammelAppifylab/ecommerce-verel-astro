import {useInfiniteQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import type {AdminDiscount, AdminDiscountCode} from '../../../lib/types/admin/promotions';
import {ApiError} from '../../api';
import {discountCodesQuery, discountProblem, downloadCodesCsv, useDeleteUnusedCodes, useGenerateCodes} from '../../queries/discounts';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  LoadMore,
  Modal,
  SearchInput,
  StatusBadge,
  useConfirm,
  useToast,
} from '../../ui';
import {copyText, describedBy, FilterToggles, NumberInput, useCanWrite} from './controls';
import {formatDateTime, pluralize} from './helpers';

type UsedFilter = 'unused' | 'used';

/** Unique-code batch: generate, browse, copy, export, delete unused (VAREL `CodesPanel`). */
export function CodesPanel({discount}: {discount: AdminDiscount}) {
  const canWrite = useCanWrite();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [used, setUsed] = useState<UsedFilter | undefined>();
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const filter = {q: q.trim() || undefined, used: used ? used === 'used' : undefined};
  const codes = useInfiniteQuery(discountCodesQuery(discount.id, filter));
  const delUnused = useDeleteUnusedCodes(discount.id);
  const unused = discount.codesTotal - discount.codesUsed;
  const rows = codes.data?.pages.flatMap(p => p.items);

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadCodesCsv(discount.id, filter);
    } catch (e) {
      toast.danger(discountProblem(e));
    } finally {
      setExporting(false);
    }
  }

  async function deleteUnused() {
    let deleted = 0;
    const ok = await confirm({
      title: `Delete ${pluralize(unused, 'unused code')}?`,
      body: 'Customers holding these codes can no longer use them. Used codes stay for order history.',
      confirmLabel: 'Delete unused',
      pendingLabel: 'Deleting…',
      action: async () => {
        deleted = (await delUnused.mutateAsync()).deleted;
      },
    });
    if (ok) toast.success(`${pluralize(deleted, 'code')} deleted`);
  }

  const columns: Column<AdminDiscountCode>[] = [
    {
      key: 'code',
      header: 'Code',
      cell: c => (
        <span className="code-cell">
          <span className="mono">{c.code}</span>
          <IconButton icon="copy" label={`Copy ${c.code}`} variant="ghost" size="sm" onClick={() => copyText(c.code, toast)} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'shrink',
      cell: c => {
        const isUsed = !!c.usedAt || !!c.orderNumber;
        return <StatusBadge tone={isUsed ? 'neutral' : 'success'}>{isUsed ? 'Used' : 'Unused'}</StatusBadge>;
      },
    },
    {key: 'usedAt', header: 'Used', width: 'shrink', cell: c => <span className="muted">{formatDateTime(c.usedAt)}</span>},
    {
      key: 'order',
      header: 'Order',
      width: 'shrink',
      cell: c =>
        c.orderNumber ? (
          <Link to="/orders/$number" params={{number: c.orderNumber}} className="num">
            {c.orderNumber}
          </Link>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'created',
      header: 'Created',
      width: 'shrink',
      hideOnMobile: true,
      cell: c => <span className="muted">{formatDateTime(c.createdAt)}</span>,
    },
  ];

  return (
    <div className="discount-codes">
      <div className="discount-codes-head">
        <p className="muted num" data-testid="codes-count">
          {pluralize(discount.codesTotal, 'code')} · {discount.codesUsed.toLocaleString('en-US')} used · {unused.toLocaleString('en-US')} unused
        </p>
        <div className="toolbar-group">
          <Button variant="secondary" size="sm" icon="download" pending={exporting} pendingLabel="Exporting…" onClick={() => void exportCsv()}>
            Export CSV
          </Button>
          {canWrite && (
            <>
              <Button variant="secondary" size="sm" icon="trash" disabled={unused <= 0} onClick={() => void deleteUnused()}>
                Delete unused
              </Button>
              <Button size="sm" icon="plus" onClick={() => setGenerating(true)}>
                Generate codes
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="toolbar discount-toolbar">
        <SearchInput label="Search codes" placeholder="Search codes" value={q} maxLength={60} onChange={e => setQ(e.target.value)} />
        <FilterToggles<UsedFilter>
          label="Used"
          options={[
            {value: 'unused', label: 'Unused'},
            {value: 'used', label: 'Used'},
          ]}
          value={used ? [used] : undefined}
          // Single choice: the newest pick wins.
          onChange={next => setUsed(next?.length ? (next.find(v => v !== used) ?? next[0]) : undefined)}
        />
      </div>

      {codes.error && !codes.data ? (
        <div className="discount-load-error">
          <ErrorNote error={codes.error} title="Codes could not be loaded" />
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void codes.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <DataTable
            caption="Unique codes"
            columns={columns}
            rows={rows}
            rowKey={c => c.id}
            loading={codes.isLoading}
            empty={
              q || used ? (
                <EmptyState icon="search" title="No codes match." />
              ) : (
                <EmptyState
                  icon="tag"
                  title="No codes yet. Generate a batch to share with customers."
                  action={
                    canWrite && (
                      <Button variant="secondary" size="sm" onClick={() => setGenerating(true)}>
                        Generate codes
                      </Button>
                    )
                  }
                />
              )
            }
          />
          <LoadMore query={codes} />
        </>
      )}

      {canWrite && generating && <GenerateModal discount={discount} onClose={() => setGenerating(false)} />}
    </div>
  );
}

const SAMPLE = 'K7Q2M9XAHT4PWNR3';

function GenerateModal({discount, onClose}: {discount: AdminDiscount; onClose: () => void}) {
  const gen = useGenerateCodes(discount.id);
  const toast = useToast();
  const [count, setCount] = useState('100');
  const [prefix, setPrefix] = useState('');
  const [length, setLength] = useState('8');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');

  const n = Number(count);
  const len = Number(length);
  const sample = `${prefix}${SAMPLE.slice(0, length && Number.isFinite(len) ? Math.min(16, Math.max(6, len)) : 8)}`;

  function check() {
    const e: Record<string, string> = {};
    if (!count.trim() || !Number.isInteger(n) || n < 1 || n > 5000) e.count = 'Between 1 and 5,000.';
    if (!length.trim() || !Number.isInteger(len) || len < 6 || len > 16) e.length = 'Between 6 and 16.';
    if (prefix && !/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(prefix)) e.prefix = 'Up to 20 letters, numbers or dashes, starting with a letter or number.';
    return e;
  }

  function submit() {
    const e = check();
    setErrors(e);
    setStatus('');
    const first = Object.keys(e)[0];
    if (first) {
      document.getElementById(`gen-${first}`)?.focus();
      return;
    }
    gen.mutate(
      {count: n, prefix: prefix || undefined, length: len},
      {
        onSuccess: ({created}) => {
          toast.success(`${pluralize(created, 'code')} created`);
          onClose();
        },
        onError: err => {
          if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
          setStatus(discountProblem(err));
        },
      }
    );
  }

  const busy = gen.isPending;
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title="Generate codes"
      description={`Single-use codes for ${discount.name || 'this discount'}. They never collide with existing codes.`}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="generate-codes" pending={busy} pendingLabel="Generating…">
            Generate
          </Button>
        </>
      }>
      <form
        id="generate-codes"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}>
        <fieldset disabled={busy} className="generate-grid">
          <Field label="How many" id="gen-count" error={errors.count} hint="Up to 5,000 at a time.">
            <NumberInput
              id="gen-count"
              value={count}
              decimals={false}
              invalid={!!errors.count}
              describedBy={describedBy('gen-count', errors.count, true)}
              onChange={setCount}
            />
          </Field>
          <Field label="Length" id="gen-length" error={errors.length} hint="6–16 characters.">
            <NumberInput
              id="gen-length"
              value={length}
              decimals={false}
              invalid={!!errors.length}
              describedBy={describedBy('gen-length', errors.length, true)}
              onChange={setLength}
            />
          </Field>
          <div className="generate-wide">
            <Field label="Prefix" id="gen-prefix" error={errors.prefix} hint={`e.g. ${sample}`} optional>
              <input
                id="gen-prefix"
                className="mono"
                value={prefix}
                maxLength={20}
                placeholder="Optional, e.g. VIP-"
                autoComplete="off"
                spellCheck={false}
                onChange={e => setPrefix(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                aria-invalid={!!errors.prefix || undefined}
                aria-describedby={describedBy('gen-prefix', errors.prefix, true)}
              />
            </Field>
          </div>
        </fieldset>
      </form>
      <p className="discount-form-status" role="status">
        {busy ? `Generating ${pluralize(Number.isFinite(n) ? n : 0, 'code')}…` : status}
      </p>
    </Modal>
  );
}
