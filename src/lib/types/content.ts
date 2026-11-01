/* Content shapes: journal posts, CMS pages, navigation menus (VAREL src/lib/api/types.ts, content.ts).
   Routes: /site-api/posts (posts.ts, WP-06), /site-api/pages, /site-api/menus (pages.ts WP-07, menus.ts WP-01). */
import type { Photo } from './common'

export interface Post {
  slug: string
  title: string
  category: string // English category name (link value: /journal/category/<slugify(category)>)
  /** Category name in the request language (display) */
  categoryLabel?: string
  date: string // display, "14 August 2026"
  publishedAt: string // ISO
  read: string // "6 min read"
  author: string
  excerpt: string
  image: Photo
}

export type PostBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'quote'; text: string; cite?: string }
  | { type: 'image'; image: Photo; caption?: string }
  | { type: 'list'; items: string[] }

export interface PostDetail extends Post {
  body: PostBlock[]
  related: Post[]
  seoTitle?: string | null
  seoDescription?: string | null
  /** ISO; last edit (article:modified_time, sitemap lastmod) */
  updatedAt?: string
}

export interface PostCategory {
  name: string // English (slug / link / filter value)
  count: number
  /** Category name in the request language (display) */
  label?: string
}

/** GET /site-api/posts/feed: the newest published posts for /rss.xml (WP-06 fills it). */
export interface FeedItem {
  slug: string
  title: string
  excerpt: string
  category: string
  author: string
  publishedAt: string // ISO
}

export interface FeedResponse {
  items: FeedItem[]
}

export interface CmsPage {
  slug: string
  title: string
  body: PostBlock[]
  seoTitle: string | null
  seoDescription: string | null
  updatedAt: string
}

export interface MenuItem {
  label: string
  url: string
}

export type MenuKey = 'header' | 'footer-studio' | 'footer-shop' | 'footer-help'

export interface Menu {
  key: MenuKey
  title: string
  items: MenuItem[]
}

/** True for links that leave the store (rendered as a plain <a>). */
export const isExternalUrl = (url: string) => /^(https?:|mailto:)/i.test(url)

/** POST /site-api/contact (WP-07) */
export interface ContactInput {
  name: string
  email: string
  subject: string
  message: string
  orderNumber?: string
}
