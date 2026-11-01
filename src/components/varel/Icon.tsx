import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleAlert, Download, Eye, EyeOff, Heart, Info, Leaf, LoaderCircle, Lock, LogOut, Mail, MapPin,
  Menu, Minus, Package, Pencil, Phone, Plus, Recycle, RotateCcw, Ruler, Search, ShoppingBag,
  SlidersHorizontal, Trash2, Truck, User, X, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** Approved VAREL glyphs (design-system README) plus a few extended utility glyphs.
 *  Lucide 0.454.0 is a documented substitution — swapping the set touches only this file. */
export const ICONS = {
  // approved
  search: Search,
  'shopping-bag': ShoppingBag,
  heart: Heart,
  user: User,
  x: X,
  menu: Menu,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  plus: Plus,
  minus: Minus,
  'sliders-horizontal': SlidersHorizontal,
  truck: Truck,
  package: Package,
  ruler: Ruler,
  check: Check,
  // extended — use sparingly, a design decision each time
  'chevron-left': ChevronLeft,
  'chevron-up': ChevronUp,
  'arrow-up-right': ArrowUpRight,
  download: Download,
  lock: Lock,
  eye: Eye,
  'eye-off': EyeOff,
  loader: LoaderCircle,
  'rotate-ccw': RotateCcw,
  mail: Mail,
  'map-pin': MapPin,
  phone: Phone,
  'log-out': LogOut,
  trash: Trash2,
  pencil: Pencil,
  info: Info,
  alert: CircleAlert,
  leaf: Leaf,
  recycle: Recycle,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

export interface IconProps {
  /** Lucide icon name in kebab-case (see ICONS) */
  name: IconName
  /** px — 20 in chrome, 16 inline with copy, 28 for editorial value blocks */
  size?: number
  /** Stroke width; 1.25 is the brand default, 1 for large editorial use */
  stroke?: number
  color?: string
  className?: string
  /** Accessible label. When omitted the icon is decorative (aria-hidden). */
  title?: string
}

/** Renders one Lucide glyph at VAREL's 1.25 stroke weight. */
export function Icon({ name, size = 20, stroke = 1.25, color = 'currentColor', className, title }: IconProps) {
  const Glyph = ICONS[name]
  return (
    <Glyph
      width={size}
      height={size}
      strokeWidth={stroke}
      color={color}
      className={cn('inline-block shrink-0', className)}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? 'img' : undefined}
      focusable="false"
    />
  )
}
