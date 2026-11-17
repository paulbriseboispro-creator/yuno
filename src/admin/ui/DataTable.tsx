/**
 * Le tableau de l'admin (TanStack Table) : tri par colonne, recherche,
 * pagination, et les quatre états qu'une liste doit savoir dire (chargement,
 * erreur avec « Réessayer », vide, données). Une ligne mène à sa fiche
 * (`onRowClick` ou `rowHref`).
 *
 *   const columns: ColumnDef<Row>[] = [
 *     { accessorKey: 'name', header: t('…') },
 *     { accessorKey: 'revenue', header: t('…'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
 *   ];
 *   <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.error} onRetry={q.refetch} searchable />
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type Row, type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react';
import { useAdminT } from './i18n';
import { fmtNum } from '@/lib/adminFormat';
import { EmptyState, ErrorState } from './EmptyState';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    align?: 'left' | 'right' | 'center';
    /** Largeur CSS de la colonne (« 120px », « 30% »). */
    width?: string;
    /** Fond teinté selon la valeur de la case (v3) : `cellTint(valeur, max)`. */
    tint?: (row: TData) => string | undefined;
  }
}

export type { ColumnDef } from '@tanstack/react-table';

export interface DataTableProps<T> {
  data: T[] | null | undefined;
  columns: ColumnDef<T, unknown>[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Champ de recherche plein texte (toutes les colonnes). */
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  initialSort?: SortingState;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string | null;
  empty?: { title: ReactNode; body?: ReactNode; action?: ReactNode };
  /** Contenu à droite de la barre (filtres, export). */
  toolbar?: ReactNode;
  getRowId?: (row: T, index: number) => string;
  /** Recherche déjà posée à l'ouverture (lien « voir ce compte » d'une autre page, `?q=`). */
  initialSearch?: string | null;
}

export function DataTable<T>({
  data, columns, loading, error, onRetry, searchable, searchPlaceholder, pageSize = 25,
  initialSort = [], onRowClick, rowHref, empty, toolbar, getRowId, initialSearch,
}: DataTableProps<T>) {
  const { t, lang: language } = useAdminT();
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [globalFilter, setGlobalFilter] = useState(initialSearch ?? '');
  const rows = useMemo(() => data ?? [], [data]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    getRowId,
  });

  const clickable = !!onRowClick || !!rowHref;
  const open = (row: Row<T>) => {
    if (onRowClick) onRowClick(row.original);
    else if (rowHref) { const href = rowHref(row.original); if (href) navigate(href); }
  };

  const filtered = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: size } = table.getState().pagination;
  const pageCount = table.getPageCount();

  let body: ReactNode;
  if (error && !loading) {
    body = <ErrorState onRetry={onRetry} />;
  } else if (loading) {
    body = (
      <div className="flex flex-col gap-2 p-4" aria-busy>
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="a-skel h-7 w-full" />)}
      </div>
    );
  } else if (rows.length === 0) {
    body = <EmptyState title={empty?.title ?? t('adm.ui.table.empty')} body={empty?.body} action={empty?.action} />;
  } else if (filtered === 0) {
    body = <EmptyState title={t('adm.ui.table.noMatch')} action={<button type="button" className="a-btn a-btn--sm" onClick={() => setGlobalFilter('')}>{t('adm.ui.table.clear')}</button>} />;
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="a-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta;
                  const sorted = h.column.getIsSorted();
                  const canSort = h.column.getCanSort();
                  return (
                    <th key={h.id} style={{ width: meta?.width, textAlign: meta?.align ?? 'left' }}
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}>
                      {h.isPlaceholder ? null : canSort ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 border-0 bg-transparent p-0 font-[inherit] text-[inherit] hover:text-[var(--a-text)]"
                          style={{ cursor: 'pointer', flexDirection: meta?.align === 'right' ? 'row-reverse' : 'row' }}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === 'asc' ? <ArrowUp className="h-3 w-3" /> : sorted === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} data-clickable={clickable} onClick={clickable ? () => open(row) : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter') open(row); } : undefined}>
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <td key={cell.id} className={meta?.align === 'right' ? 'a-num' : undefined} style={{ textAlign: meta?.align ?? 'left', background: meta?.tint?.(row.original) }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="a-card overflow-hidden">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          {searchable && (
            <label className="relative min-w-[200px] max-w-[320px] flex-1">
              <Search className="a-t3 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
              <input className="a-input" style={{ paddingLeft: 30 }} value={globalFilter}
                onChange={(e) => { setGlobalFilter(e.target.value); table.setPageIndex(0); }}
                placeholder={searchPlaceholder ?? t('adm.ui.table.search')} aria-label={searchPlaceholder ?? t('adm.ui.table.search')} />
            </label>
          )}
          <div className="ml-auto flex items-center gap-2">{toolbar}</div>
        </div>
      )}
      {body}
      {!loading && !error && filtered > 0 && (
        <div className="a-t2 flex items-center gap-3 border-t px-3 py-2 text-[12.5px]">
          <span className="a-num flex-1">
            {pageCount > 1
              ? t('adm.ui.table.range', { from: fmtNum(pageIndex * size + 1, language), to: fmtNum(Math.min(filtered, (pageIndex + 1) * size), language), total: fmtNum(filtered, language) })
              : t(filtered === 1 ? 'adm.ui.table.countOne' : 'adm.ui.table.count', { n: fmtNum(filtered, language) })}
          </span>
          {pageCount > 1 && (
            <>
              <button type="button" className="a-btn a-btn--sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>{t('adm.ui.table.prev')}</button>
              <button type="button" className="a-btn a-btn--sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>{t('adm.ui.table.next')}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
