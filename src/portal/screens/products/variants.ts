/* Variant options model for the product editor (Shopify-style, up to 3 options): options read from rows, rows built
   from options. Colour and size are built-in kinds stored in their own columns; any other option is custom and its
   value lives in VariantItem.options under the option's name. Pure, so it is unit tested
   (tests/variants-model.test.ts).

   Port of VAREL `src/pages/admin/products/variants.ts`, plus the variant row type and SKU / price helpers that VAREL
   kept in `form.ts` (`KNOWN_SWATCHES`, `SIZE_PRESETS`, `uid`, `VariantItem`, `variantSku`, `effectiveSku`,
   `effectivePrice`): they live here so the product editor's `form.ts` (WP-17) imports them from `./variants`
   without a form ↔ variants import cycle. WP-18 owns this file. */
import type {AdminProductOption} from '../../../lib/types/admin/catalog';

export type ProductOption = AdminProductOption;

/* ---------- Rows and SKUs (VAREL form.ts) ---------- */

export const KNOWN_SWATCHES: Record<string, string> = {
  Black: '#1A1A1A',
  Stone: '#CFC8BE',
  Olive: '#6B6A57',
  Navy: '#2B3242',
  Bone: '#E4DED4',
  Camel: '#B39271',
  Charcoal: '#3A3B3D',
  Oat: '#DDD3C2',
  Tan: '#A9835F',
  Steel: '#B8BCC2',
  White: '#F4F2EE',
};

export const SIZE_PRESETS: {label: string; sizes: string[]}[] = [
  {label: 'XS–XL', sizes: ['XS', 'S', 'M', 'L', 'XL']},
  {label: 'EU 36–41', sizes: ['36', '37', '38', '39', '40', '41']},
  {label: 'EU 40–45', sizes: ['40', '41', '42', '43', '44', '45']},
  {label: 'One size', sizes: ['One size']},
];

let uidCounter = 0;
/** A row id that is stable while editing (SKUs and names can change). */
export const uid = () => `u${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

export interface VariantItem {
  uid: string;
  /** SKU; empty = generated from the base SKU, colour and size on save (shown as a placeholder) */
  id: string;
  color: string | null;
  size: string | null;
  swatch: string | null;
  /** Custom option values by option name, e.g. { Fabric: 'Canvas' } */
  options: Record<string, string>;
  /** Empty = uses the product price (and follows it when it changes) */
  price: string;
  inventory: string;
}

/** The editor's variants state: the options and the rows built from them. */
export interface VariantsState {
  options: OptionDef[];
  variants: VariantItem[];
}

/** The SKU alphabet the server accepts (WP-17 `variantInput`): a letter or digit, then letters, digits, `.`, `_`, `-`; ≤ 64. */
export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SKU_MAX = 64;
export const SKU_HINT = 'Use letters, numbers, dots, underscores and hyphens';

const code = (s: string, n: number) =>
  s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, n);

/** `SKU-COL-SIZE-CUSTOM`, e.g. VRL-LCS-STO-M or VRL-LCS-STO-M-CAN */
export function variantSku(base: string, color: string | null, size: string | null, custom: string[] = []): string {
  const parts = [base || 'SKU'];
  if (color) parts.push(code(color, 3) || 'COL');
  if (size) parts.push(size === 'One size' ? 'OS' : code(size, 4) || 'SZ');
  for (const c of custom) parts.push(code(c, 4) || 'OPT');
  return parts.join('-');
}

/** A variant's SKU as saved: its own, or the generated one. */
export const effectiveSku = (v: Pick<VariantItem, 'id' | 'color' | 'size'> & {options?: Record<string, string>}, base: string) =>
  v.id.trim() || variantSku(base, v.color, v.size, Object.values(v.options ?? {}));

/** A variant's price as saved: its own, or the product's. */
export const effectivePrice = (v: Pick<VariantItem, 'price'>, productPrice: string) => (v.price.trim() === '' ? productPrice : v.price);

/* ---------- Options ---------- */

export type OptKind = 'color' | 'size' | 'custom';

export interface OptValue {
  name: string;
  /** Swatch, colour options only */
  hex?: string;
}

export interface OptionDef {
  /** Stable while editing (names can change) */
  id: string;
  kind: OptKind;
  name: string;
  values: OptValue[];
}

export const MAX_OPTIONS = 3;
export const NEUTRAL = '#B3B3B3';
export const KIND_LABEL: Record<Exclude<OptKind, 'custom'>, string> = {color: 'Colour', size: 'Size'};

/** Rough swatches for colour words, so "Moss green" starts green rather than grey. The last known word wins. */
const COLOUR_WORDS: Record<string, string> = {
  black: '#1A1A1A', white: '#F4F2EE', grey: '#9A9A9A', gray: '#9A9A9A', silver: '#C4C6C8', charcoal: '#3A3B3D',
  red: '#9E2B25', burgundy: '#5E1F28', wine: '#5E1F28', pink: '#E3B5B8', rose: '#D9A5A0', orange: '#C8682F', rust: '#8A3A2E',
  yellow: '#E2C25B', mustard: '#C49A2C', ochre: '#B98A3E', gold: '#B8975A', beige: '#E3D5BE', sand: '#D8C7A8', cream: '#F1E9D8',
  ivory: '#F3EEDF', ecru: '#E9E0CB', brown: '#6B4A33', chocolate: '#4A3020', tan: '#A9835F', camel: '#B39271', khaki: '#A39A73',
  green: '#4F6B4A', olive: '#6B6A57', moss: '#5E6B45', sage: '#9DAA8F', forest: '#2F4A35', mint: '#BCD9C6',
  blue: '#3B5B8C', navy: '#2B3242', denim: '#4A6385', sky: '#A9C4DE', teal: '#2F6E6E', indigo: '#33355E',
  purple: '#5E4677', lilac: '#BFA9D1', lavender: '#C9BEDF',
};

export function guessSwatch(name: string): string {
  if (KNOWN_SWATCHES[name]) return KNOWN_SWATCHES[name];
  const hit = name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(w => COLOUR_WORDS[w])
    .pop();
  return hit ? COLOUR_WORDS[hit]! : NEUTRAL;
}

/** A variant's value for an option. */
export function valueOf(v: Pick<VariantItem, 'color' | 'size' | 'options'>, d: Pick<OptionDef, 'kind' | 'name'>): string | null {
  if (d.kind === 'color') return v.color;
  if (d.kind === 'size') return v.size;
  return v.options?.[d.name] ?? null;
}

/** The row with an option set to a value (or cleared with null). */
export function withValue(v: VariantItem, d: Pick<OptionDef, 'kind' | 'name'>, value: string | null): VariantItem {
  if (d.kind === 'color') return {...v, color: value};
  if (d.kind === 'size') return {...v, size: value};
  const options = {...(v.options ?? {})};
  if (value == null) delete options[d.name];
  else options[d.name] = value;
  return {...v, options};
}

/** Identity of a combination across the options in use. */
export const comboKey = (v: Pick<VariantItem, 'color' | 'size' | 'options'>, defs: OptionDef[]) =>
  defs
    .filter(d => d.values.length)
    .map(d => valueOf(v, d) ?? '')
    .join('|');

/**
 * One order out of several partial ones: the longest list is the base, and a value missing from it goes right after
 * its nearest earlier neighbour. So sizes stay XS, S, M… even when the first colour lacks XS.
 */
function mergeOrder(seqs: string[][]): string[] {
  const sorted = [...seqs].sort((a, b) => b.length - a.length);
  const out = [...(sorted[0] ?? [])];
  for (const seq of sorted.slice(1))
    seq.forEach((v, i) => {
      if (out.includes(v)) return;
      const before = seq
        .slice(0, i)
        .reverse()
        .find(p => out.includes(p));
      out.splice(before ? out.indexOf(before) + 1 : 0, 0, v);
    });
  return out;
}

let defCounter = 0;
const defId = () => `o${Date.now().toString(36)}${(defCounter++).toString(36)}`;

export const newOption = (kind: OptKind, name = kind === 'custom' ? '' : KIND_LABEL[kind]): OptionDef => ({
  id: defId(),
  kind,
  name,
  values: [],
});

/**
 * The options of a product: the saved list (names, order, values) when there is one, completed from the rows;
 * older products without a list get colour, size and any custom names found on the variants.
 */
export function optionsFrom(variants: VariantItem[], saved: ProductOption[] = []): OptionDef[] {
  const names = new Set<string>();
  for (const v of variants) for (const k of Object.keys(v.options ?? {})) names.add(k);
  const skeleton: Pick<OptionDef, 'kind' | 'name'>[] = saved.length
    ? saved.map(o => ({kind: o.kind, name: o.name}))
    : [
        ...(variants.some(v => v.color) ? [{kind: 'color' as const, name: KIND_LABEL.color}] : []),
        ...(variants.some(v => v.size) ? [{kind: 'size' as const, name: KIND_LABEL.size}] : []),
        ...[...names].map(name => ({kind: 'custom' as const, name})),
      ];
  // Custom names on rows that the saved list lacks still show up rather than vanish on save.
  for (const name of names) if (!skeleton.some(d => d.kind === 'custom' && d.name === name)) skeleton.push({kind: 'custom', name});

  return skeleton.slice(0, MAX_OPTIONS).map(d => {
    // Each value's order: the saved order first, then the order rows give it within groups of the other options.
    const groups = new Map<string, string[]>();
    for (const v of variants) {
      const val = valueOf(v, d);
      if (!val) continue;
      const k = skeleton
        .filter(o => o !== d)
        .map(o => valueOf(v, o) ?? '')
        .join('|');
      const list = groups.get(k) ?? [];
      if (!list.includes(val)) list.push(val);
      groups.set(k, list);
    }
    const fromRows = mergeOrder([...groups.values()]);
    const savedValues = saved.find(o => o.kind === d.kind && o.name === d.name)?.values ?? [];
    const ordered = [...savedValues.filter(v => fromRows.includes(v)), ...fromRows.filter(v => !savedValues.includes(v))];
    const hexOf = (name: string) => variants.find(v => v.color === name)?.swatch ?? guessSwatch(name);
    return {
      id: defId(),
      kind: d.kind,
      name: d.name,
      values: ordered.map(name => (d.kind === 'color' ? {name, hex: hexOf(name)} : {name})),
    };
  });
}

/** Rows for the options: one per combination, keeping rows that already exist (price, stock, SKU). */
export function build(defs: OptionDef[], prev: VariantItem[], removed: ReadonlySet<string>): VariantItem[] {
  const active = defs.filter(d => d.values.length > 0);
  const byKey = new Map(prev.map(v => [comboKey(v, active), v]));
  // Going from no options to options: the lone default row hands its price to the new rows.
  const lone = prev.length === 1 && !prev[0]!.color && !prev[0]!.size && !Object.keys(prev[0]!.options ?? {}).length ? prev[0]! : null;
  let combos: VariantItem[] = [{uid: '', id: '', color: null, size: null, swatch: null, options: {}, price: lone?.price ?? '', inventory: '0'}];
  for (const d of active)
    combos = combos.flatMap(c =>
      d.values.map(val => ({...withValue(c, d, val.name), ...(d.kind === 'color' ? {swatch: val.hex ?? null} : {})}))
    );
  const out: VariantItem[] = [];
  for (const c of combos) {
    const k = comboKey(c, active);
    if (removed.has(k)) continue;
    const existing = byKey.get(k) ?? (active.length === 0 ? prev[0] : undefined);
    out.push(existing ? {...existing, color: c.color, size: c.size, options: c.options, swatch: c.swatch} : {...c, uid: uid()});
  }
  return out;
}

/** Combinations the saved rows leave out: variants someone removed, which must stay removed. */
export function missingCombos(defs: OptionDef[], variants: VariantItem[]): Set<string> {
  const active = defs.filter(d => d.values.length > 0);
  if (active.length < 2) return new Set();
  const have = new Set(variants.map(v => comboKey(v, active)));
  return new Set(
    build(active, [], new Set())
      .map(c => comboKey(c, active))
      .filter(k => !have.has(k))
  );
}

/** The option list as saved on the product. */
export const toProductOptions = (defs: OptionDef[]): ProductOption[] =>
  defs
    .filter(d => d.values.length > 0 && d.name.trim())
    .map(d => ({kind: d.kind, name: d.name.trim(), values: d.values.map(v => v.name)}));
