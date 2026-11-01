/**
 * Customers screens (WP-20): the port of VAREL `src/pages/admin/customers/*`. The export names are
 * the ones src/portal/routes.tsx lazy-loads; the CSS is `./screen.css` (bundled by src/layouts/App.astro).
 *
 *   List.tsx         `/dashboard/customers`       (CustomersList.tsx, actions.tsx row menu + bulk bar)
 *   Detail.tsx       `/dashboard/customers/$id`   (CustomerDetail.tsx)
 *   RoleDialog.tsx   role change through the template users API (actions.tsx RoleDialog)
 *   PrivacyCard.tsx  export / delete (PrivacyPanel.tsx)
 *   ProfileDrawer.tsx edit the shop profile (new)
 */
export {CustomersList} from './List';
export {CustomerDetail} from './Detail';
