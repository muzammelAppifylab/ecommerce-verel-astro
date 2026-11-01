import {slugify} from '../../lib/format';
import type {PostBlock} from '../../lib/types/content';

export interface Heading {
  id: string;
  text: string;
}

/**
 * The anchor id of every block that gets one (h2 blocks), by block index. Ids are stable slugs of the
 * heading text (VAREL), de-duplicated (`-2`, `-3`) and `section-<n>` when the text has no Latin
 * letters (a translated heading), so the contents nav and the body always agree.
 */
export function headingIds(body: PostBlock[]): Map<number, string> {
  const ids = new Map<number, string>();
  const used = new Set<string>();
  let n = 0;
  body.forEach((b, i) => {
    if (b.type !== 'h2') return;
    n += 1;
    const base = slugify(b.text) || `section-${n}`;
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    ids.set(i, id);
  });
  return ids;
}

/** Contents entries from the post's h2 blocks (VAREL `headingsOf`). */
export function headingsOf(body: PostBlock[]): Heading[] {
  const ids = headingIds(body);
  return body.flatMap((b, i) => (b.type === 'h2' ? [{id: ids.get(i)!, text: b.text}] : []));
}

/** Quote text without one leading and one trailing quote mark (the body wraps it in “ ”). */
export const quoteText = (text: string) => text.replace(/^[“"]|[”"]$/g, '');
