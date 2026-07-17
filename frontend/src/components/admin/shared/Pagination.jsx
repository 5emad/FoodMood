import { faDigits } from '../../../utils/format';

export default function Pagination({ page, totalPages, total, onPage }) {
  const current = Number(page || 1);
  const pages = Number(totalPages || 1);
  const count = Number(total || 0);

  if (pages <= 1) {
    return count ? <div className="table-footer-meta"><span className="page-summary">{faDigits(count)} رکورد</span></div> : null;
  }

  const start = Math.max(1, current - 2);
  const end = Math.min(pages, current + 2);
  const pageNums = [];
  for (let p = start; p <= end; p += 1) pageNums.push(p);

  return (
    <div className="pagination-bar">
      <button type="button" className="page-btn" disabled={current <= 1} onClick={() => onPage(current - 1)}>قبلی</button>
      {pageNums.map((p) => (
        <button key={p} type="button" className={`page-btn${p === current ? ' active' : ''}`} onClick={() => onPage(p)}>
          {faDigits(p)}
        </button>
      ))}
      <button type="button" className="page-btn" disabled={current >= pages} onClick={() => onPage(current + 1)}>بعدی</button>
      {count > 0 && <span className="page-summary">{faDigits(count)} رکورد</span>}
    </div>
  );
}
