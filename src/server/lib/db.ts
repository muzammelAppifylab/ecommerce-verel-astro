/* The Site Database client types the domain libraries accept (PLAN.md §2: VAREL `getDb(env)` → the template's
   `getDb()` / `c.var.db`). Never make a client here: routes get one from `withDb`, pages from `pageContext()`. */
import type { Prisma, PrismaClient } from '../../generated/prisma/client'

export type DbClient = PrismaClient
/** A client or an interactive-transaction client — what lib helpers accept. */
export type Db = PrismaClient | Prisma.TransactionClient
