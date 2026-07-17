const { formatJalaliDate } = require('../helpers/DateHelper');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderSupplierReportHtml(report) {
  const generatedAt = escapeHtml(formatJalaliDate(new Date()));
  const orgName = escapeHtml(report.organizationName || 'سامانه تغذیه سازمانی');
  const days = report.byDayPrep || [];
  const prepTotals = report.prepTotals || { totalMeals: 0, userMeals: 0, guestMeals: 0 };

  const daySections = days.map((day) => {
    const rows = (day.foods || []).map((food, index) => `
      <tr>
        <td class="col-idx">${(index + 1).toLocaleString('fa-IR')}</td>
        <td class="col-food">${escapeHtml(food.foodName)}</td>
        <td class="col-count">${Number(food.count || 0).toLocaleString('fa-IR')}</td>
        <td class="col-note"></td>
      </tr>
    `).join('');

    return `
    <div class="day-block">
      <div class="day-head">
        <span class="day-title">${escapeHtml(day.jalaliDate)}</span>
        <span class="day-meta">جمع روز: ${Number(day.totalMeals || 0).toLocaleString('fa-IR')} پرس</span>
      </div>
      <div class="tbl-wrap">
        <table class="prep-grid">
          <thead>
            <tr>
              <th class="col-idx">#</th>
              <th class="col-food">نام غذا</th>
              <th class="col-count">تعداد پرس</th>
              <th class="col-note">یادداشت</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" class="empty-cell">سفارشی برای این روز ثبت نشده</td></tr>'}
            ${rows ? `<tr class="total-row"><td colspan="2">جمع روز</td><td class="col-count">${Number(day.totalMeals || 0).toLocaleString('fa-IR')}</td><td></td></tr>` : ''}
          </tbody>
        </table>
      </div>
      <div class="day-split">
        پرسنل: ${Number(day.userMeals || 0).toLocaleString('fa-IR')}
        — مهمان: ${Number(day.guestMeals || 0).toLocaleString('fa-IR')}
      </div>
    </div>`;
  }).join('');

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 12mm 10mm 14mm 10mm;
      @bottom-center {
        content: "صفحه " counter(page) " از " counter(pages);
        font-family: Vazirmatn, Tahoma, sans-serif;
        font-size: 8pt; color: #444; direction: rtl;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Vazirmatn, Tahoma, sans-serif;
      direction: rtl; color: #111; background: #fff;
      font-size: 10pt; line-height: 1.45;
    }
    .letterhead {
      border: 1pt solid #000; margin-bottom: 10pt; page-break-inside: avoid;
    }
    .lh-top { border-bottom: 1pt solid #000; padding: 8pt 12pt; text-align: center; }
    .lh-org-main { font-size: 13pt; font-weight: 700; }
    .lh-org-sub { font-size: 8.5pt; margin-top: 2pt; }
    .lh-meta { display: flex; border-bottom: 1pt solid #000; }
    .lh-cell {
      flex: 1; padding: 5pt 8pt; border-left: 1pt solid #000;
      font-size: 8.5pt; min-width: 0;
    }
    .lh-cell:last-child { border-left: none; }
    .lh-cell-label { font-size: 7.5pt; margin-bottom: 2pt; }
    .lh-cell-val { font-weight: 700; word-break: break-word; }
    .lh-subject { padding: 5pt 12pt; font-size: 9pt; }
    .lh-subject-label { margin-left: 6pt; }
    .lh-subject-val { font-weight: 700; }

    .stats {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt;
      border: 1pt solid #000; padding: 7pt; margin-bottom: 10pt;
    }
    .stat { text-align: center; font-size: 8.5pt; }
    .stat-val { font-weight: 700; display: block; font-size: 11pt; }
    .stat-label { font-size: 7.5pt; }

    .note-box {
      border: 1pt dashed #666; padding: 6pt 8pt; margin-bottom: 10pt;
      font-size: 8pt; color: #333;
    }

    .day-block { margin-bottom: 10pt; page-break-inside: avoid; }
    .day-head {
      display: flex; justify-content: space-between; align-items: center;
      border: 1pt solid #000; border-bottom: none;
      padding: 5pt 8pt; background: #f5f5f5; font-weight: 700; font-size: 9pt;
    }
    .day-meta { font-size: 8pt; font-weight: 600; }
    .day-split {
      border: 1pt solid #000; border-top: none;
      padding: 4pt 8pt; font-size: 7.5pt; color: #444;
    }
    .tbl-wrap { border: 1pt solid #000; }
    .prep-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    thead th {
      padding: 4pt 6pt; font-size: 8pt; font-weight: 700; text-align: center;
      border-bottom: 1pt solid #000; border-left: 1pt solid #ccc;
    }
    thead th:last-child { border-left: none; }
    tbody td {
      padding: 4pt 6pt; font-size: 8pt;
      border-bottom: 1pt solid #ddd; border-left: 1pt solid #eee;
      vertical-align: middle;
    }
    tbody td:last-child { border-left: none; }
    tbody tr:last-child td { border-bottom: none; }
    .col-idx { width: 8%; text-align: center; }
    .col-food { width: 46%; text-align: right; }
    .col-count { width: 14%; text-align: center; font-weight: 700; }
    .col-note { width: 32%; }
    .total-row td { font-weight: 700; background: #f7f7f7; border-top: 1pt solid #000; }
    .empty-cell { text-align: center; padding: 8pt; color: #666; }

    .doc-footer {
      margin-top: 10pt; padding-top: 5pt; border-top: 1pt solid #000;
      display: flex; justify-content: space-between; font-size: 7pt; gap: 8pt;
    }
  </style>
</head>
<body>
  <div class="letterhead">
    <div class="lh-top">
      <div class="lh-org-main">${orgName}</div>
      <div class="lh-org-sub">گزارش آماده‌سازی غذا — تامین‌کننده</div>
    </div>
    <div class="lh-meta">
      <div class="lh-cell">
        <div class="lh-cell-label">شماره گزارش</div>
        <div class="lh-cell-val">${escapeHtml(report.reportNumber || '—')}</div>
      </div>
      <div class="lh-cell">
        <div class="lh-cell-label">تاریخ صدور</div>
        <div class="lh-cell-val">${generatedAt}</div>
      </div>
      <div class="lh-cell">
        <div class="lh-cell-label">بازه هفته</div>
        <div class="lh-cell-val">${escapeHtml(report.range.jalaliStart)} تا ${escapeHtml(report.range.jalaliEnd)}</div>
      </div>
      <div class="lh-cell">
        <div class="lh-cell-label">نوع</div>
        <div class="lh-cell-val">هفتگی</div>
      </div>
    </div>
    <div class="lh-subject">
      <span class="lh-subject-label">موضوع:</span>
      <span class="lh-subject-val">${escapeHtml(report.title)}</span>
    </div>
  </div>

  <div class="stats">
    <div class="stat"><span class="stat-val">${Number(prepTotals.totalMeals || 0).toLocaleString('fa-IR')}</span><span class="stat-label">جمع کل پرس</span></div>
    <div class="stat"><span class="stat-val">${Number(prepTotals.userMeals || 0).toLocaleString('fa-IR')}</span><span class="stat-label">پرسنل</span></div>
    <div class="stat"><span class="stat-val">${Number(prepTotals.guestMeals || 0).toLocaleString('fa-IR')}</span><span class="stat-label">مهمان</span></div>
  </div>

  <div class="note-box">این گزارش شامل سفارش‌های تاییدشده پرسنل و مهمان است. بخش امضا ندارد.</div>

  ${daySections || '<div class="empty-cell">سفارش تاییدشده‌ای برای این هفته وجود ندارد</div>'}

  <div class="doc-footer">
    <span>گزارش تامین‌کننده — ${generatedAt}</span>
    <span>سامانه مدیریت تغذیه سازمانی</span>
  </div>
</body>
</html>`;
}

module.exports = { renderSupplierReportHtml };
