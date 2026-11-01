import {useQuery} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useState} from 'react';

import {pluralize} from '../../../lib/format';
import type {AdminCategory, AdminDepartment} from '../../../lib/types/admin/catalog';
import {ApiError} from '../../api';
import {departmentsQuery, type TaxonomyOp, useTaxonomyMutation} from '../../queries/catalog';
import {useMe} from '../../shared';
import {
  Button,
  Card,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  IconButton,
  LoadingBlock,
  Menu,
  PageHeader,
  useConfirm,
  useToast,
} from '../../ui';
import {NameModal} from './NameModal';

/**
 * `/dashboard/catalog` (port of VAREL `src/pages/admin/catalog/Departments.tsx`): departments and
 * their categories, the shop navigation and the product filters. Add and rename in a dialog, order
 * with the move buttons, delete with a confirmation that turns into "View products" while products
 * still use the department or category. Read-only without `manageProducts`.
 */

type Target = {kind: 'dept'; item: AdminDepartment} | {kind: 'cat'; item: AdminCategory; dept: AdminDepartment};

type Dialog =
  | {kind: 'addDept'}
  | {kind: 'renameDept'; dept: AdminDepartment}
  | {kind: 'addCat'; dept: AdminDepartment}
  | {kind: 'renameCat'; cat: AdminCategory; dept: AdminDepartment};

/** "12 products", "100+ products" (the server counts at most 101). */
export const productsText = (n: number) => (n > 100 ? '100+ products' : pluralize(n, 'product'));

export function inUseMessage(t: Target): string {
  const n = t.item.productCount;
  const what = t.kind === 'dept' ? 'department' : 'category';
  return n > 0
    ? `${t.item.name} still has ${productsText(n)}. Move them to another ${what} before deleting it.`
    : `${t.item.name} is still used by products, including archived ones. Move them before deleting it.`;
}

/** The writes that renumber a list after moving one item (VAREL `reorder`): only items whose position changes. */
export function reorderOps<T extends {id: string; position: number}>(list: T[], index: number, dir: -1 | 1, kind: 'dept' | 'cat'): TaxonomyOp[] {
  const to = index + dir;
  if (to < 0 || to >= list.length) return [];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next.flatMap((x, i) =>
    x.position === i ? [] : [kind === 'dept' ? {kind: 'updateDept' as const, id: x.id, position: i} : {kind: 'updateCat' as const, id: x.id, position: i}]
  );
}

const byPosition = <T extends {position: number}>(list: T[]) => [...list].sort((a, b) => a.position - b.position);

export function Departments() {
  const me = useMe();
  const readOnly = !me.data?.abilities.manageProducts;
  const departments = useQuery(departmentsQuery);
  const mutation = useTaxonomyMutation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  /** The department whose card is being reordered or changed (that card dims; the others stay usable). */
  const [busy, setBusy] = useState<string | null>(null);

  const sorted = byPosition(departments.data ?? []);

  const move = (ops: TaxonomyOp[], deptId: string) => {
    if (!ops.length) return;
    setBusy(deptId);
    mutation.mutate(ops, {
      onError: e => toast.danger(e instanceof Error ? e.message : 'The order could not be saved'),
      onSettled: () => setBusy(null),
    });
  };

  const productsSearch = (t: Target) => (t.kind === 'dept' ? {dept: t.item.name} : {dept: t.dept.name, category: t.item.name});

  async function askDelete(t: Target) {
    if (t.item.productCount > 0) {
      const go = await confirm({title: `${t.item.name} is in use`, body: inUseMessage(t), confirmLabel: 'View products', tone: 'primary'});
      if (go) void navigate({to: '/products', search: productsSearch(t)});
      return;
    }
    const cats = t.kind === 'dept' ? t.item.categories.length : 0;
    const body =
      t.kind === 'dept'
        ? cats
          ? `The department and its ${pluralize(cats, 'category', 'categories')} are removed from the shop navigation. This cannot be undone.`
          : 'The department is removed from the shop navigation. This cannot be undone.'
        : `The category is removed from ${t.dept.name}. This cannot be undone.`;
    const done = await confirm({
      title: `Delete ${t.item.name}?`,
      body,
      confirmLabel: 'Delete',
      pendingLabel: 'Deleting…',
      tone: 'danger',
      action: async () => {
        try {
          await mutation.mutateAsync(t.kind === 'dept' ? {kind: 'deleteDept', id: t.item.id} : {kind: 'deleteCat', id: t.item.id});
        } catch (e) {
          // A product moved in since the list was read: say so in words, in the dialog.
          if (e instanceof ApiError && e.status === 409) throw new Error(inUseMessage({...t, item: {...t.item, productCount: 0}} as Target));
          throw e;
        }
      },
    });
    if (done) toast.success(`${t.item.name} deleted`);
  }

  const save = async (d: Dialog, name: string) => {
    switch (d.kind) {
      case 'addDept':
        await mutation.mutateAsync({kind: 'createDept', name, position: sorted.length});
        toast.success(`${name} added`);
        return;
      case 'renameDept':
        await mutation.mutateAsync({kind: 'updateDept', id: d.dept.id, name});
        toast.success('Department renamed');
        return;
      case 'addCat':
        await mutation.mutateAsync({kind: 'createCat', deptId: d.dept.id, name, position: d.dept.categories.length});
        toast.success(`${name} added to ${d.dept.name}`);
        return;
      case 'renameCat':
        await mutation.mutateAsync({kind: 'updateCat', id: d.cat.id, name});
        toast.success('Category renamed');
    }
  };

  const modal = dialog && {
    addDept: {title: 'Add department', initial: '', submit: 'Add department', pending: 'Adding…'},
    renameDept: {title: `Rename ${dialog.kind === 'renameDept' ? dialog.dept.name : ''}`, initial: '', submit: 'Rename', pending: 'Renaming…'},
    addCat: {title: `Add category to ${dialog.kind === 'addCat' ? dialog.dept.name : ''}`, initial: '', submit: 'Add category', pending: 'Adding…'},
    renameCat: {title: `Rename ${dialog.kind === 'renameCat' ? dialog.cat.name : ''}`, initial: '', submit: 'Rename', pending: 'Renaming…'},
  }[dialog.kind];
  const initial = dialog?.kind === 'renameDept' ? dialog.dept.name : dialog?.kind === 'renameCat' ? dialog.cat.name : '';

  return (
    <div className="app-page screen-catalog">
      <PageHeader
        title="Departments"
        description={
          readOnly
            ? 'Departments and categories organise the shop. Only people who manage products can change them.'
            : 'Departments and categories organise the shop navigation and product filters.'
        }
        actions={
          readOnly ? undefined : (
            <Button icon="plus" onClick={() => setDialog({kind: 'addDept'})}>
              Add department
            </Button>
          )
        }
      />

      {departments.isPending ? (
        <div className="dept-list" aria-busy="true">
          {Array.from({length: 3}, (_, i) => (
            <Card key={i}>
              <LoadingBlock rows={2} />
            </Card>
          ))}
        </div>
      ) : departments.isError ? (
        <div className="dept-error">
          <ErrorNote title="Departments could not be loaded" error={departments.error} />
          <Button variant="secondary" onClick={() => void departments.refetch()}>
            Try again
          </Button>
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon="list-tree"
            title="No departments yet."
            action={
              readOnly ? undefined : (
                <Button icon="plus" onClick={() => setDialog({kind: 'addDept'})}>
                  Add department
                </Button>
              )
            }>
            Departments are the first level of the shop menu, at /shop/&lt;department&gt;/.
          </EmptyState>
        </Card>
      ) : (
        <div className="dept-list">
          {sorted.map((d, di) => (
            <DepartmentCard
              key={d.id}
              dept={d}
              readOnly={readOnly}
              busy={busy === d.id}
              locked={busy !== null}
              first={di === 0}
              last={di === sorted.length - 1}
              onMove={dir => move(reorderOps(sorted, di, dir, 'dept'), d.id)}
              onMoveCat={(ci, dir) => move(reorderOps(byPosition(d.categories), ci, dir, 'cat'), d.id)}
              onRename={() => setDialog({kind: 'renameDept', dept: d})}
              onAddCat={() => setDialog({kind: 'addCat', dept: d})}
              onRenameCat={cat => setDialog({kind: 'renameCat', cat, dept: d})}
              onDelete={() => void askDelete({kind: 'dept', item: d})}
              onDeleteCat={cat => void askDelete({kind: 'cat', item: cat, dept: d})}
            />
          ))}
        </div>
      )}

      <NameModal
        open={!!dialog}
        title={modal?.title ?? ''}
        initial={initial}
        submitLabel={modal?.submit ?? ''}
        pendingLabel={modal?.pending ?? ''}
        hint={dialog?.kind === 'addDept' || dialog?.kind === 'renameDept' ? 'Shown in the shop menu; its address follows the name.' : undefined}
        onClose={() => setDialog(null)}
        onSubmit={name => (dialog ? save(dialog, name) : Promise.resolve())}
      />
    </div>
  );
}

function DepartmentCard({
  dept: d,
  readOnly,
  busy,
  locked,
  first,
  last,
  onMove,
  onMoveCat,
  onRename,
  onAddCat,
  onRenameCat,
  onDelete,
  onDeleteCat,
}: {
  dept: AdminDepartment;
  readOnly: boolean;
  /** This card's write is running. */
  busy: boolean;
  /** Some reorder is running (moves wait for it, as VAREL disabled them while pending). */
  locked: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onMoveCat: (index: number, dir: -1 | 1) => void;
  onRename: () => void;
  onAddCat: () => void;
  onRenameCat: (cat: AdminCategory) => void;
  onDelete: () => void;
  onDeleteCat: (cat: AdminCategory) => void;
}) {
  const cats = byPosition(d.categories);

  const columns: Column<AdminCategory>[] = [];
  if (!readOnly)
    columns.push({
      key: 'order',
      header: 'Order',
      width: 'shrink',
      cell: c => {
        const ci = cats.indexOf(c);
        return (
          <span className="move-buttons">
            <IconButton icon="chevron-up" size="sm" label={`Move ${c.name} up`} disabled={ci === 0 || locked} onClick={() => onMoveCat(ci, -1)} />
            <IconButton
              icon="chevron-down"
              size="sm"
              label={`Move ${c.name} down`}
              disabled={ci === cats.length - 1 || locked}
              onClick={() => onMoveCat(ci, 1)}
            />
          </span>
        );
      },
    });
  columns.push(
    {key: 'name', header: 'Name', cell: c => <span className="cell-title">{c.name}</span>},
    {key: 'slug', header: 'Slug', hideOnMobile: true, cell: c => <span className="muted">{c.slug}</span>},
    {
      key: 'products',
      header: 'Products',
      align: 'end',
      width: 'shrink',
      cell: c => (
        <Link className="dept-count" to="/products" search={{dept: d.name, category: c.name}}>
          {productsText(c.productCount)}
        </Link>
      ),
    }
  );
  if (!readOnly)
    columns.push({
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: c => (
        <Menu
          label={`Actions for ${c.name}`}
          disabled={locked}
          items={[
            {label: 'Rename', icon: 'pencil', onSelect: () => onRenameCat(c)},
            'separator',
            {label: 'Delete category', icon: 'trash', danger: true, onSelect: () => onDeleteCat(c)},
          ]}
        />
      ),
    });

  return (
    <div className="dept-card" aria-busy={busy || undefined} data-testid="department">
      <Card
        title={d.name}
        description={
          <>
            /shop/{d.slug}/ ·{' '}
            <Link className="dept-count" to="/products" search={{dept: d.name}}>
              {productsText(d.productCount)}
            </Link>{' '}
            · {pluralize(cats.length, 'category', 'categories')}
          </>
        }
        actions={
          readOnly ? undefined : (
            <>
              <IconButton icon="chevron-up" size="sm" label={`Move ${d.name} up`} disabled={first || locked} onClick={() => onMove(-1)} />
              <IconButton icon="chevron-down" size="sm" label={`Move ${d.name} down`} disabled={last || locked} onClick={() => onMove(1)} />
              <Menu
                label={`Actions for ${d.name}`}
                disabled={locked}
                items={[
                  {label: 'Rename', icon: 'pencil', onSelect: onRename},
                  {label: 'Add category', icon: 'plus', onSelect: onAddCat},
                  'separator',
                  {label: 'Delete department', icon: 'trash', danger: true, onSelect: onDelete},
                ]}
              />
            </>
          )
        }
        flush>
        <DataTable
          caption={`Categories in ${d.name}`}
          columns={columns}
          rows={cats}
          rowKey={c => c.id}
          empty={
            <div className="dept-empty">
              <p className="muted">No categories yet.</p>
              {!readOnly && (
                <Button variant="secondary" size="sm" icon="plus" onClick={onAddCat}>
                  Add category
                </Button>
              )}
            </div>
          }
        />
      </Card>
    </div>
  );
}
