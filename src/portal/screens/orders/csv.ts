/* Client-side CSV of selected order rows (pure: no React, unit-tested in tests/admin-orders.test.ts). */
import type {AdminOrderRow} from '../../../lib/types/admin/sales';

/** A CSV cell, quoted when needed and guarded against spreadsheet formulas (as the server's `csvCell`). */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvText = (rows: (string | number | null | undefined)[][]) => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** The selected rows as VAREL exported them (the server export covers whole filtered lists). */
export function selectedCsvRows(rows: AdminOrderRow[]): (string | number)[][] {
  return [
    ['Order', 'Placed', 'Customer', 'Email', 'Payment', 'Fulfilment', 'Items', 'Total'],
    ...rows.map(o => [o.number, o.placedAt, o.customerName, o.email, o.payment, o.fulfillment, o.count, o.total.toFixed(2)]),
  ];
}
