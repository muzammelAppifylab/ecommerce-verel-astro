import {type ReactNode, useRef, useState} from 'react';

import {Icon} from './icon';

/**
 * Drag-to-reorder list (merchandising: collections, a collection's products,
 * category order, menu items), ported from VAREL
 * (`pages/admin/collections/SortableList.tsx`).
 *
 * Pointer: drag the grip (native HTML drag and drop). Keyboard: the up / down
 * buttons on each row, or focus the grip and press Alt+Arrow. The new order is
 * announced to screen readers.
 */

/** A copy of `list` with the item at `from` moved to `to` (unchanged when out of range). */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function SortableList<T>({
  items,
  getKey,
  getLabel,
  onReorder,
  renderItem,
  renderActions,
  disabled,
  label,
  className,
}: {
  items: T[];
  getKey: (item: T) => string | number;
  /** Accessible name of a row, e.g. the product name. */
  getLabel: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  renderActions?: (item: T, index: number) => ReactNode;
  disabled?: boolean;
  /** Accessible name of the list. */
  label: string;
  className?: string;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const grips = useRef<(HTMLButtonElement | null)[]>([]);

  const commit = (from: number, to: number, focus = false) => {
    if (to < 0 || to >= items.length || from === to) return;
    onReorder(move(items, from, to));
    setAnnounce(`${getLabel(items[from] as T)} moved to position ${to + 1} of ${items.length}`);
    if (focus) requestAnimationFrame(() => grips.current[to]?.focus());
  };

  return (
    <>
      <ol aria-label={label} className={['sortable-list', className].filter(Boolean).join(' ')}>
        {items.map((item, i) => {
          const name = getLabel(item);
          const target = over === i && dragging !== null && dragging !== i ? (dragging < i ? 'after' : 'before') : undefined;
          return (
            <li
              key={getKey(item)}
              className="sortable-row"
              data-dragging={dragging === i ? '' : undefined}
              data-drop={target}
              onDragOver={event => {
                if (dragging === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (over !== i) setOver(i);
              }}
              onDrop={event => {
                event.preventDefault();
                if (dragging !== null) commit(dragging, i);
                setDragging(null);
                setOver(null);
              }}>
              {!disabled && (
                <button
                  type="button"
                  ref={node => {
                    grips.current[i] = node;
                  }}
                  className="sortable-grip"
                  draggable
                  aria-label={`Reorder ${name}. Alt and arrow keys move it`}
                  title="Drag to reorder"
                  onDragStart={event => {
                    setDragging(i);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(getKey(item)));
                    const row = event.currentTarget.closest('li');
                    if (row) event.dataTransfer.setDragImage(row, 16, 16);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  onKeyDown={event => {
                    if (!event.altKey) return;
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      commit(i, i - 1, true);
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      commit(i, i + 1, true);
                    }
                  }}>
                  <Icon name="grip" size={16} />
                </button>
              )}
              <span className="sortable-index" aria-hidden="true">
                {i + 1}
              </span>
              <div className="sortable-body">{renderItem(item, i)}</div>
              {renderActions?.(item, i)}
              {!disabled && (
                <span className="sortable-moves">
                  <button type="button" className="sortable-move" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => commit(i, i - 1)}>
                    <Icon name="chevron-up" size={16} />
                  </button>
                  <button
                    type="button"
                    className="sortable-move"
                    aria-label={`Move ${name} down`}
                    disabled={i === items.length - 1}
                    onClick={() => commit(i, i + 1)}>
                    <Icon name="chevron-down" size={16} />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <span className="visually-hidden" aria-live="polite">
        {announce}
      </span>
    </>
  );
}
