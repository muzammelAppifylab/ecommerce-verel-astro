import type {ReactNode} from 'react';

import type {NavLink} from './menus';

/** A menu entry: a store link (already localized) or a new-tab link for external URLs (mailto: stays in the tab).
 *  `active` marks the current department: `.active` + aria-current="page", underlined like the hover state. */
export function MenuLink({
  item,
  className,
  activeClassName = 'active underline underline-offset-5',
  active = false,
  onClick,
  children,
}: {
  item: NavLink;
  className?: string;
  activeClassName?: string;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  if (item.external) {
    return (
      <a href={item.href} className={className} onClick={onClick} target="_blank" rel="noopener noreferrer">
        {children ?? item.label}
      </a>
    );
  }
  return (
    <a
      href={item.href}
      className={active ? [className, activeClassName].filter(Boolean).join(' ') : className}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}>
      {children ?? item.label}
    </a>
  );
}
