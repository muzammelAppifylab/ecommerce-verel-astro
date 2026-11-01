/* `Astro.locals` set by src/middleware.ts (PLAN.md D7). A global script declaration: no imports or exports. */
declare namespace App {
  interface Locals {
    /** Storefront language of this request: the URL prefix ("da" for /da/shop/), else "en". */
    locale: string;
  }
}
