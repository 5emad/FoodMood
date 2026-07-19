const { formatJalaliDate } = require('../helpers/DateHelper');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('fa-IR')} تومان`;
}

function compactMoney(value) {
  return Number(value || 0).toLocaleString('fa-IR');
}

function renderFoodCell(foods, cellMode = 'names') {
  if (!foods?.length) return '<span class="food-empty">-</span>';
  if (cellMode === 'type1') {
    const isType1 = foods.some((food) => {
      if (food && typeof food === 'object') return !!food.isType1;
      return false;
    });
    return `<div class="food-item">${isType1 ? 'بله' : 'خیر'}</div>`;
  }
  return foods.map((food) => {
    const label = food && typeof food === 'object' ? (food.name || '-') : food;
    return `<div class="food-item">${escapeHtml(label)}</div>`;
  }).join('');
}

function renderSignatureSection() {
  const roles = ['مسئول خدمات', 'مدیر پشتیبانی', 'مدیر عامل'];
  return `
  <div class="sign-area">
    <div class="sign-head">تاییدیه و امضاء مسئولین</div>
    <div class="sign-body">
      ${roles.map((role) => `
      <div class="sign-col">
        <div class="sign-col-title">${role}</div>
        <div class="sign-col-name">.............................</div>
        <div class="sign-col-stamp">مهر و امضاء</div>
      </div>`).join('')}
    </div>
  </div>`;
}

function groupUsersByDepartment(users) {
  const map = new Map();
  for (const user of users || []) {
    const dept = user.department || 'بدون واحد';
    if (!map.has(dept)) map.set(dept, []);
    map.get(dept).push(user);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fa'));
}

function buildGuestWeeklyColgroup(dayCount) {
  const dayWidth = dayCount > 0 ? Math.max(8, Math.floor(50 / dayCount)) : 10;
  const dayCols = Array.from({ length: dayCount }, () => `<col class="col-day" style="width:${dayWidth}%">`).join('');
  return `
    <colgroup>
      <col class="col-idx" style="width:4%">
      <col class="col-code" style="width:7%">
      <col class="col-name" style="width:12%">
      <col class="col-type" style="width:6%">
      ${dayCols}
      <col class="col-total" style="width:6%">
      <col class="col-price" style="width:8%">
    </colgroup>`;
}

function renderGuestWeeklyRows(report) {
  const cellMode = report.cellMode === 'type1' ? 'type1' : 'names';
  const dayCount = report.byGuest?.[0]?.days?.length || report.byUser[0]?.days?.length || 0;
  const dayHeaders = (report.byGuest?.[0]?.days || report.days || []).map((day) => `<th class="col-day">${escapeHtml(day.jalaliDate)}</th>`).join('');
  let rowIndex = 0;
  const rows = (report.byGuest || []).map((guest) => {
    rowIndex += 1;
    return `
    <tr>
      <td class="col-idx">${rowIndex.toLocaleString('fa-IR')}</td>
      <td class="col-code">${escapeHtml(guest.guestCode)}</td>
      <td class="col-name">${escapeHtml(guest.fullName)}</td>
      <td class="col-type">${escapeHtml(guest.guestTypeLabel || (guest.guestType === 'permanent' ? 'دائم' : 'موقت'))}</td>
      ${guest.days.map((day) => `<td class="col-day">${renderFoodCell(day.foods, cellMode)}</td>`).join('')}
      <td class="col-total">${Number(guest.total || 0).toLocaleString('fa-IR')}</td>
      <td class="col-price" title="${formatMoney(guest.totalPrice)}">${compactMoney(guest.totalPrice)}</td>
    </tr>`;
  }).join('');
  const colSpan = dayCount + 6;
  return {
    dayHeaders,
    rows: rows || `<tr><td colspan="${colSpan}" class="empty-cell">سفارش مهمان تاییدشده‌ای ثبت نشده است</td></tr>`,
    dayCount,
  };
}

function renderGuestMonthlyRows(report) {
  const guests = (report.byGuest || []).slice().sort((a, b) => b.total - a.total);
  const totalCount = guests.reduce((sum, guest) => sum + Number(guest.total || 0), 0);
  const totalPrice = guests.reduce((sum, guest) => sum + Number(guest.totalPrice || 0), 0);
  const rows = guests.map((guest, index) => `
      <tr>
        <td>${(index + 1).toLocaleString('fa-IR')}</td>
        <td class="col-code">${escapeHtml(guest.guestCode)}</td>
        <td class="col-name">${escapeHtml(guest.fullName)}</td>
        <td class="col-type">${escapeHtml(guest.guestTypeLabel || (guest.guestType === 'permanent' ? 'دائم' : 'موقت'))}</td>
        <td class="col-total">${Number(guest.total || 0).toLocaleString('fa-IR')}</td>
        <td class="col-price" title="${formatMoney(guest.totalPrice)}">${compactMoney(guest.totalPrice)}</td>
      </tr>
    `).join('');
  return { rows, totalCount, totalPrice, hasRows: guests.length > 0 };
}

function buildWeeklyColgroup(dayCount) {
  const dayWidth = dayCount > 0 ? Math.max(8, Math.floor(54 / dayCount)) : 10;
  const dayCols = Array.from({ length: dayCount }, () => `<col class="col-day" style="width:${dayWidth}%">`).join('');
  return `
    <colgroup>
      <col class="col-idx" style="width:4%">
      <col class="col-name" style="width:13%">
      <col class="col-dept" style="width:9%">
      ${dayCols}
      <col class="col-total" style="width:6%">
      <col class="col-price" style="width:8%">
    </colgroup>`;
}

function renderReportHtml(report) {
  const isMonthlyReport = report.type === 'month';
  const cellMode = report.cellMode === 'type1' ? 'type1' : 'names';
  const generatedAt = escapeHtml(formatJalaliDate(new Date()));
  const orgName = escapeHtml(report.organizationName || 'سامانه تغذیه سازمانی');
  const dayCount = report.byUser[0]?.days?.length || 0;
  const weeklySecTitle = cellMode === 'type1'
    ? 'گزارش پرسنلی — نوع یک هر روز (بله/خیر)'
    : 'گزارش پرسنلی — تفکیک روزانه سفارشات هفته';

  const userDayHeaders = report.byUser[0]?.days?.map((day) => `<th class="col-day">${escapeHtml(day.jalaliDate)}</th>`).join('') || '';
  let rowIndex = 0;
  const userRows = groupUsersByDepartment(report.byUser).flatMap(([department, users]) => {
    const sorted = users.slice().sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'fa'));
    const colSpan = dayCount + 5;
    const header = `
    <tr class="dept-group-row">
      <td colspan="${colSpan}">${escapeHtml(department)} (${sorted.length.toLocaleString('fa-IR')} نفر)</td>
    </tr>`;
    const body = sorted.map((user) => {
      rowIndex += 1;
      return `
    <tr>
      <td class="col-idx">${rowIndex.toLocaleString('fa-IR')}</td>
      <td class="col-name">${escapeHtml(user.fullName)}</td>
      <td class="col-dept">${escapeHtml(user.department)}</td>
      ${user.days.map((day) => `<td class="col-day">${renderFoodCell(day.foods, cellMode)}</td>`).join('')}
      <td class="col-total">${Number(user.total || 0).toLocaleString('fa-IR')}</td>
      <td class="col-price" title="${formatMoney(user.totalPrice)}">${compactMoney(user.totalPrice)}</td>
    </tr>`;
    }).join('');
    return header + body;
  }).join('');

  const missingRows = Object.entries(report.missingUsers || {})
    .sort((a, b) => a[0].localeCompare(b[0], 'fa'))
    .map(([department, names]) => `
    <tr><td>${escapeHtml(department)}</td><td class="missing-names">${escapeHtml(names.slice().sort((a, b) => String(a).localeCompare(String(b), 'fa')).join('، '))}</td><td>${names.length.toLocaleString('fa-IR')}</td></tr>
  `).join('');

  const monthlyUsers = (report.byUser || []).slice().sort((a, b) => b.total - a.total);
  const monthlyTotalCount = monthlyUsers.reduce((sum, user) => sum + Number(user.total || 0), 0);
  const monthlyTotalPrice = monthlyUsers.reduce((sum, user) => sum + Number(user.totalPrice || 0), 0);
  const monthlyUserRows = monthlyUsers
    .map((user, index) => `
      <tr>
        <td>${(index + 1).toLocaleString('fa-IR')}</td>
        <td class="col-name">${escapeHtml(user.fullName)}</td>
        <td class="col-dept">${escapeHtml(user.department || 'بدون واحد')}</td>
        <td class="col-total">${Number(user.total || 0).toLocaleString('fa-IR')}</td>
        <td class="col-price" title="${formatMoney(user.totalPrice)}">${compactMoney(user.totalPrice)}</td>
      </tr>
    `).join('');

  const weeklyColSpan = dayCount + 5;
  const guestWeekly = renderGuestWeeklyRows(report);
  const weeklyBody = `
  <div class="stats stats-weekly">
    <div class="stat"><span class="stat-val">${report.totals.totalOrders.toLocaleString('fa-IR')}</span> <span class="stat-label">سفارش تاییدشده</span></div>
    <div class="stat"><span class="stat-val">${(report.totals.totalMeals || report.totals.totalOrders || 0).toLocaleString('fa-IR')}</span> <span class="stat-label">جمع وعده</span></div>
    <div class="stat"><span class="stat-val">${compactMoney(report.totals.totalPrice)}</span> <span class="stat-label">مبلغ کل (تومان)</span></div>
  </div>

  <div class="sec-title">${weeklySecTitle}</div>
  <div class="tbl-wrap wide">
    <table class="report-grid">
      ${buildWeeklyColgroup(dayCount)}
      <thead><tr><th class="col-idx">#</th><th class="col-name">نام و نام خانوادگی</th><th class="col-dept">واحد</th>${userDayHeaders}<th class="col-total">جمع وعده</th><th class="col-price">هزینه (ت)</th></tr></thead>
      <tbody>${userRows || `<tr><td colspan="${weeklyColSpan}" class="empty-cell">سفارش تاییدشده‌ای ثبت نشده است</td></tr>`}</tbody>
    </table>
  </div>

  <div class="sec-title">پرسنل فاقد سفارش</div>
  <div class="tbl-wrap">
    <table class="report-grid">
      <thead><tr><th>واحد سازمانی</th><th>نام افراد</th><th>تعداد</th></tr></thead>
      <tbody>${missingRows || '<tr><td colspan="3" class="empty-cell">همه پرسنل سفارش ثبت کرده‌اند</td></tr>'}</tbody>
    </table>
  </div>

  <div class="sec-title">گزارش مهمان — تفکیک روزانه سفارشات هفته</div>
  <div class="tbl-wrap wide">
    <table class="report-grid">
      ${buildGuestWeeklyColgroup(guestWeekly.dayCount)}
      <thead><tr><th class="col-idx">#</th><th class="col-code">کد مهمان</th><th class="col-name">نام مهمان</th><th class="col-type">نوع</th>${guestWeekly.dayHeaders}<th class="col-total">جمع وعده</th><th class="col-price">هزینه (ت)</th></tr></thead>
      <tbody>${guestWeekly.rows}</tbody>
    </table>
  </div>`;

  const monthlyBody = `
  <div class="sec-title">گزارش ماهیانه پرسنل — خلاصه وعده‌ها و هزینه</div>
  <div class="tbl-wrap">
    <table class="report-grid monthly-grid">
      <colgroup>
        <col style="width:6%">
        <col style="width:34%">
        <col style="width:20%">
        <col style="width:18%">
        <col style="width:22%">
      </colgroup>
      <thead><tr><th>#</th><th class="col-name">نام و نام خانوادگی</th><th class="col-dept">واحد</th><th class="col-total">جمع وعده</th><th class="col-price">هزینه (ت)</th></tr></thead>
      <tbody>
        ${monthlyUserRows || '<tr><td colspan="5" class="empty-cell">سفارش تاییدشده‌ای ثبت نشده است</td></tr>'}
        ${monthlyUserRows ? `<tr class="total-row"><td colspan="3">جمع کل</td><td class="col-total">${monthlyTotalCount.toLocaleString('fa-IR')}</td><td class="col-price">${compactMoney(monthlyTotalPrice)}</td></tr>` : ''}
      </tbody>
    </table>
  </div>

  ${(() => {
    const guestMonthly = renderGuestMonthlyRows(report);
    return `
  <div class="sec-title">گزارش ماهیانه مهمان — خلاصه وعده‌ها و هزینه</div>
  <div class="tbl-wrap">
    <table class="report-grid monthly-grid">
      <colgroup>
        <col style="width:6%">
        <col style="width:12%">
        <col style="width:30%">
        <col style="width:12%">
        <col style="width:18%">
        <col style="width:22%">
      </colgroup>
      <thead><tr><th>#</th><th class="col-code">کد مهمان</th><th class="col-name">نام مهمان</th><th class="col-type">نوع</th><th class="col-total">جمع وعده</th><th class="col-price">هزینه (ت)</th></tr></thead>
      <tbody>
        ${guestMonthly.rows || '<tr><td colspan="6" class="empty-cell">سفارش مهمان تاییدشده‌ای ثبت نشده است</td></tr>'}
        ${guestMonthly.hasRows ? `<tr class="total-row"><td colspan="4">جمع کل مهمان</td><td class="col-total">${guestMonthly.totalCount.toLocaleString('fa-IR')}</td><td class="col-price">${compactMoney(guestMonthly.totalPrice)}</td></tr>` : ''}
      </tbody>
    </table>
  </div>`;
  })()}`;

  const pageRule = isMonthlyReport
    ? '@page { size: A4; margin: 14mm 12mm 18mm 12mm;'
    : '@page { size: A4 landscape; margin: 10mm 8mm 14mm 8mm;';

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <style>
    ${pageRule}
      @bottom-center {
        content: "صفحه " counter(page) " از " counter(pages);
        font-family: Vazirmatn, Tahoma, sans-serif;
        font-size: 8pt; color: #444; direction: rtl;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Vazirmatn, Tahoma, sans-serif;
      direction: rtl; color: #111;
      background: #fff;
      font-size: 9.5pt;
      line-height: 1.45;
    }

    .letterhead {
      border: 1pt solid #000;
      margin-bottom: 10pt;
      page-break-inside: avoid;
    }
    .lh-top {
      border-bottom: 1pt solid #000;
      padding: 8pt 12pt;
      text-align: center;
    }
    .lh-org-main { font-size: 13pt; font-weight: 700; }
    .lh-org-sub  { font-size: 8.5pt; margin-top: 2pt; }
    .lh-meta {
      display: flex;
      border-bottom: 1pt solid #000;
    }
    .lh-cell {
      flex: 1; padding: 5pt 8pt;
      border-left: 1pt solid #000;
      font-size: 8.5pt;
      min-width: 0;
    }
    .lh-cell:last-child { border-left: none; }
    .lh-cell-label { font-size: 7.5pt; margin-bottom: 2pt; }
    .lh-cell-val { font-weight: 700; word-break: break-word; }
    .lh-subject {
      padding: 5pt 12pt;
      font-size: 9pt;
      word-break: break-word;
    }
    .lh-subject-label { margin-left: 6pt; }
    .lh-subject-val { font-weight: 700; }

    .stats {
      display: grid;
      gap: 6pt; margin-bottom: 10pt;
      border: 1pt solid #000;
      padding: 7pt;
    }
    .stats-weekly { grid-template-columns: repeat(3, 1fr); }
    .stat { text-align: center; font-size: 8.5pt; min-width: 0; }
    .stat-val { font-weight: 700; display: block; font-size: 10pt; word-break: break-word; }
    .stat-label { font-size: 7.5pt; }

    .sec-title {
      border: 1pt solid #000;
      border-bottom: none;
      font-size: 9pt; font-weight: 700;
      padding: 4pt 8pt;
      margin-top: 8pt;
      page-break-after: avoid;
    }

    .tbl-wrap {
      border: 1pt solid #000;
      margin-bottom: 8pt;
      overflow: hidden;
    }
    .report-grid {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      page-break-inside: auto;
    }
    thead { display: table-header-group; }
    thead th {
      padding: 4pt 5pt; font-size: 7.5pt; font-weight: 700;
      text-align: center;
      border-bottom: 1pt solid #000;
      border-left: 1pt solid #ccc;
      vertical-align: middle;
      word-break: break-word;
    }
    thead th.col-name, thead th.col-dept { text-align: right; }
    thead th:last-child { border-left: none; }
    tbody td {
      padding: 3pt 4pt; font-size: 7.5pt;
      border-bottom: 1pt solid #ddd;
      border-left: 1pt solid #eee;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    tbody td:last-child { border-left: none; }
    tbody tr:last-child td { border-bottom: none; }
    .dept-group-row td {
      background: #f0f4ff;
      font-weight: 700;
      padding: 4pt 6pt;
      page-break-after: avoid;
    }
    .col-idx, .col-total, .col-price { text-align: center; white-space: nowrap; }
    .col-price { direction: ltr; font-size: 7pt; }
    .col-name, .col-dept { text-align: right; }
    .col-day { font-size: 6.8pt; line-height: 1.25; }
    .food-item { margin-bottom: 1.5pt; }
    .food-item:last-child { margin-bottom: 0; }
    .food-empty { color: #666; }
    .missing-names { text-align: right; }
    .total-row td { font-weight: 700; border-top: 1pt solid #000; background: #f7f7f7; }
    .empty-cell { text-align: center; padding: 8pt; }

    .sign-area {
      margin-top: 14pt; page-break-inside: avoid;
      border: 1pt solid #000;
    }
    .sign-head {
      border-bottom: 1pt solid #000;
      padding: 4pt 8pt; font-size: 8.5pt; font-weight: 700;
    }
    .sign-body {
      display: grid; grid-template-columns: repeat(3, 1fr);
      padding: 10pt 6pt 20pt;
    }
    .sign-col { border-left: 1pt dashed #999; padding: 0 6pt; text-align: center; }
    .sign-col:first-child { border-left: none; }
    .sign-col-title { font-size: 8pt; margin-bottom: 5pt; font-weight: 700; }
    .sign-col-name  { font-size: 8.5pt; margin-bottom: 5pt; }
    .sign-col-stamp {
      height: 28pt; border: 1pt dashed #999;
      width: 56pt; margin: 0 auto;
      display: flex; align-items: center; justify-content: center;
      font-size: 6.5pt; color: #666;
    }

    .doc-footer {
      margin-top: 10pt; padding-top: 5pt;
      border-top: 1pt solid #000;
      display: flex; justify-content: space-between;
      font-size: 7pt;
      gap: 8pt;
    }
  </style>
</head>
<body>

  <div class="letterhead">
    <div class="lh-top">
      <div class="lh-org-main">${orgName}</div>
      <div class="lh-org-sub">گزارش سامانه مدیریت تغذیه</div>
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
        <div class="lh-cell-label">بازه گزارش</div>
        <div class="lh-cell-val">${escapeHtml(report.range.jalaliStart)} تا ${escapeHtml(report.range.jalaliEnd)}</div>
      </div>
      <div class="lh-cell">
        <div class="lh-cell-label">نوع گزارش</div>
        <div class="lh-cell-val">${isMonthlyReport ? 'ماهیانه' : 'هفتگی'}</div>
      </div>
    </div>
    <div class="lh-subject">
      <span class="lh-subject-label">موضوع:</span>
      <span class="lh-subject-val">${escapeHtml(report.title)}</span>
    </div>
  </div>

  ${isMonthlyReport ? monthlyBody : weeklyBody}

  ${renderSignatureSection()}

  <div class="doc-footer">
    <span>تولید شده توسط سامانه مدیریت تغذیه سازمانی — ${generatedAt}</span>
    <span>این سند دارای اعتبار داخلی است</span>
  </div>

</body>
</html>`;
}

module.exports = { renderReportHtml };
