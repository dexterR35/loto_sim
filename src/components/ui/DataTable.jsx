import { useState } from 'react';
import {
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const TABLE_FEATURES = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text
  }
});

export function DataTable({
  columns,
  data = [],
  pageSize = DEFAULT_PAGE_SIZE,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  manualPagination = false,
  rowCount,
  pageCount,
  pagination: controlledPagination,
  onPaginationChange,
  getRowId,
  empty = 'No rows to show'
}) {
  const [sorting, setSorting] = useState([]);
  const [internalPagination, setInternalPagination] = useState({
    pageIndex: 0,
    pageSize
  });

  const pagination = controlledPagination ?? internalPagination;
  const setPagination = onPaginationChange ?? setInternalPagination;
  const resolvedPageCount = manualPagination
    ? (pageCount ?? Math.max(1, Math.ceil((rowCount || 0) / Math.max(1, pagination.pageSize))))
    : undefined;

  const table = useTable({
    features: TABLE_FEATURES,
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    manualPagination,
    rowCount: manualPagination ? rowCount : undefined,
    pageCount: resolvedPageCount,
    getRowId,
    autoResetPageIndex: !manualPagination,
    enableSortingRemoval: true,
    initialState: {
      pagination: { pageIndex: 0, pageSize }
    }
  }, (state) => ({
    pagination: state.pagination,
    sorting: state.sorting
  }));

  const rows = table.getRowModel().rows;
  const pageIndex = table.state.pagination.pageIndex;
  const size = table.state.pagination.pageSize;
  const total = manualPagination ? (rowCount ?? 0) : data.length;
  const from = total ? pageIndex * size + 1 : 0;
  const to = Math.min(total, (pageIndex + 1) * size);
  const pages = Math.max(1, table.getPageCount());

  return (
    <div className="data-table">
      <div className="data-table__scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th key={header.id} scope="col">
                      {header.isPlaceholder ? null : sortable ? (
                        <button type="button" onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden="true">{sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}</span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={Math.max(1, columns.length)} className="data-table__empty">{empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className="data-table__pager" aria-label="Table pagination">
        <p>{from}–{to} of {total.toLocaleString('en-GB')}</p>
        <div>
          <label>
            <span className="sr-only">Rows per page</span>
            <select
              value={size}
              onChange={(event) => table.setPageSize(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option} / page</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()} aria-label="First page">
            <ChevronsLeft size={14} />
          </button>
          <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
            <ChevronLeft size={14} />
          </button>
          <span>Page {pageIndex + 1} of {pages}</span>
          <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
            <ChevronRight size={14} />
          </button>
          <button type="button" onClick={() => table.lastPage()} disabled={!table.getCanNextPage()} aria-label="Last page">
            <ChevronsRight size={14} />
          </button>
        </div>
      </nav>
    </div>
  );
}
