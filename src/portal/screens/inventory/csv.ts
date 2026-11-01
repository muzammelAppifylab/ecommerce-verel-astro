/**
 * CSV for the inventory export (client side, selected rows only). VAREL's `downloadCsv` quoted
 * cells with `"`, `,` or a line break; this also applies the server's `csvCell` formula guard so a
 * product name like `=HYPERLINK(…)` opens as text in a spreadsheet.
 */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvText(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}
