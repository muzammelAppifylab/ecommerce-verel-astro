/* In-app links of the account app. The dashboard registers ITS router as TanStack Router's global type
   (src/portal/PortalApp.tsx), so typed `<Link to>` would check account paths against the dashboard's routes:
   this wrapper takes plain strings instead. Paths are relative to the basepath (`/details/`, `/orders/$number/`). */
import { Link, useNavigate } from '@tanstack/react-router'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

export interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  params?: Record<string, string>
  hash?: string
  children?: ReactNode
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnyLink = Link as unknown as (props: any) => ReactNode

export function AppLink({ to, params, hash, ...rest }: AppLinkProps) {
  return <AnyLink to={to} params={params} hash={hash} {...rest} />
}

/** `navigate('/orders/')` with string paths (see above). */
export function useAppNavigate(): (to: string, opts?: { params?: Record<string, string>; hash?: string; replace?: boolean }) => void {
  const navigate = useNavigate() as unknown as (o: Record<string, unknown>) => void
  return (to, opts = {}) => navigate({ to, ...opts })
}
