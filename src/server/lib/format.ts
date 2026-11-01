/** Shared formatting + small pure helpers. */

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "14 August 2026" */
export const displayDate = (d: Date): string => dateFmt.format(d)

/** "March 2024" */
export const monthYear = (d: Date): string => monthFmt.format(d)

export const slugify = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** "a,b , c" → ["a","b","c"] */
export const csv = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : Array.isArray(v)
      ? v.flatMap(csv)
      : []

export const normEmail = (e: string) => e.trim().toLowerCase()

/** "1 item", "2 items"; pass the plural for irregular words ("1 box", "2 boxes"). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
