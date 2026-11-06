'use client';

export const PAGE_SIZES = [10, 25, 50];

// 1 2 3 ... 9 10 style list: always first, last and the neighbours of the current page.
export function pageList(page: number, pages: number): (number | 'gap')[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - prev > 1) out.push('gap');
    out.push(n);
    prev = n;
  }
  return out;
}

interface Props {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  noun?: string;
}

export function Pagination({ total, page, pageSize, onPage, onPageSize, noun = 'items' }: Props) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pager" aria-label="Pagination">
      <span aria-live="polite">
        Showing {from}-{to} of {total} {noun}
      </span>
      <div className="pages">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          Prev
        </button>
        {pageList(page, pages).map((n, i) =>
          n === 'gap' ? (
            <span key={`g${i}`} className="gap" aria-hidden="true">
              ...
            </span>
          ) : (
            <button key={n} type="button" onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined} aria-label={`Page ${n}`}>
              {n}
            </button>
          ),
        )}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          Next
        </button>
      </div>
      <label>
        Per page
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
