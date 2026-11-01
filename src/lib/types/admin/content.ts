/* Admin content: journal posts, CMS pages, navigation menus (VAREL src/lib/admin/types.ts, content.ts, cms.ts).
   Routes: /site-api/manage/posts (WP-06), /manage/pages and /manage/menus (WP-07). */
import type { Photo } from '../common'
import type { MenuItem, MenuKey, PostBlock } from '../content'
import type { ListParams } from './common'

export type { PostBlock }

export type PostStatus = 'draft' | 'published'

export interface AdminPostRow {
  id: string // record id (Translation entityId)
  slug: string
  title: string
  category: string
  author: string
  status: PostStatus
  publishedAt: string | null
  updatedAt: string
  image: Photo
}

export interface AdminPost extends AdminPostRow {
  excerpt: string
  read: string // "6 min read" — computed by the server from body when omitted
  body: PostBlock[]
  seoTitle: string | null // overrides the <title> on the storefront
  seoDescription: string | null // overrides the excerpt as meta description
}

export interface AdminPostInput {
  slug?: string // generated from title when omitted on create; immutable after create
  title: string
  category: string
  author: string
  status: PostStatus
  publishedAt: string | null // ISO; defaults to now when publishing
  excerpt: string
  image: { src: string; credit?: string | null; creditHref?: string | null }
  body: PostBlock[]
  seoTitle?: string | null
  seoDescription?: string | null
}

export interface PostListParams extends ListParams {
  status?: PostStatus
  category?: string
}

export interface AdminPage {
  id: string
  slug: string
  title: string
  body: PostBlock[]
  published: boolean
  seoTitle: string | null
  seoDescription: string | null
  createdAt: string
  updatedAt: string
}

/** A row of the pages list (`GET /manage/pages`): the page without its body. */
export type AdminPageRow = Omit<AdminPage, 'body'>

export interface AdminPageInput {
  slug?: string
  title: string
  body: PostBlock[]
  published: boolean
  seoTitle: string | null
  seoDescription: string | null
}

export interface AdminMenu {
  /** Menu record id (Translation entityId); null until saved once */
  id: string | null
  key: MenuKey
  title: string
  items: MenuItem[]
  /** false until saved once; the storefront shows its built-in links meanwhile */
  stored: boolean
  updatedAt: string | null
}

/** PUT /site-api/manage/menus/:key */
export interface AdminMenuInput {
  title: string
  items: MenuItem[]
}
