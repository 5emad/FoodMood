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

function renderReportHtml(report) {
  const isMonthlyReport = report.type === 'month';
  const generatedAt = escapeHtml(formatJalaliDate(new Date()));
  const orgName = escapeHtml(report.organizationName || 'سامانه تغذیه سازمانی');

  const userDayHeaders = report.byUser[0]?.days?.map((day) => `<th>${escapeHtml(day.jalaliDate)}</th>`).join('') || '';
  let rowIndex = 0;
  const userRows = groupUsersByDepartment(report.byUser).flatMap(([department, users]) => {
    const sorted = users.slice().sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'fa'));
    const colSpan = (report.byUser[0]?.days?.length || 0) + 4;
    const header = `
    <tr class="dept-group-row">
      <td colspan="${colSpan}" style="background:#f0f4ff;font-weight:700;padding:6px 8px">${escapeHtml(department)} (${sorted.length.toLocaleString('fa-IR')} نفر)</td>
    </tr>`;
    const body = sorted.map((user) => {
      rowIndex += 1;
      return `
    <tr>
      <td>${rowIndex}</td>
      <td>${escapeHtml(user.fullName)}</td>
      <td>${escapeHtml(user.department)}</td>
      ${user.days.map((day) => `<td>${day.foods.length ? day.foods.map(escapeHtml).join('<br>') : '-'}</td>`).join('')}
      <td>${user.total.toLocaleString('fa-IR')}</td>
      <td>${formatMoney(user.totalPrice)}</td>
    </tr>`;
    }).join('');
    return header + body;
  }).join('');

  const missingRows = Object.entries(report.missingUsers || {})
    .sort((a, b) => a[0].localeCompare(b[0], 'fa'))
    .map(([department, names]) => `
    <tr><td>${escapeHtml(department)}</td><td>${escapeHtml(names.slice().sort((a, b) => String(a).localeCompare(String(b), 'fa')).join('، '))}</td><td>${names.length.toLocaleString('fa-IR')}</td></tr>
  `).join('');

  const monthlyUsers = (report.byUser || []).slice().sort((a, b) => b.total - a.total);
  const monthlyTotalCount = monthlyUsers.reduce((sum, user) => sum + Number(user.total || 0), 0);
  const monthlyTotalPrice = monthlyUsers.reduce((sum, user) => sum + Number(user.totalPrice || 0), 0);
  const monthlyUserRows = monthlyUsers
    .map((user, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(user.fullName)}</td>
        <td>${escapeHtml(user.department || 'بدون واحد')}</td>
        <td>${Number(user.total || 0).toLocaleString('fa-IR')}</td>
        <td>${formatMoney(user.totalPrice)}</td>
      </tr>
    `).join('');

  const weeklyColSpan = (report.byUser[0]?.days?.length || 0) + 5;
  const weeklyBody = `
  <div class="stats">
    <div class="stat"><span class="stat-val">${report.totals.totalOrders.toLocaleString('fa-IR')}</span> <span class="stat-label">سفارش تاییدشده</span></div>
    <div class="stat"><span class="stat-val">${(report.totals.totalMeals || report.totals.totalOrders || 0).toLocaleString('fa-IR')}</span> <span class="stat-label">جمع وعده</span></div>
    <div class="stat"><span class="stat-val">${formatMoney(report.totals.totalPrice)}</span> <span class="stat-label">مبلغ کل</span></div>
  </div>

  <div class="sec-title">گزارش پرسنلی — تفکیک روزانه سفارشات هفته</div>
  <div class="tbl-wrap wide">
    <table>
      <thead><tr><th>#</th><th>نام و نام خانوادگی</th><th>واحد سازمانی</th>${userDayHeaders}<th>جمع وعده</th><th>جمع هزینه</th></tr></thead>
      <tbody>${userRows || `<tr><td colspan="${weeklyColSpan}" class="empty-cell">سفارش تاییدشده‌ای ثبت نشده است</td></tr>`}</tbody>
    </table>
  </div>

  <div class="sec-title">پرسنل فاقد سفارش</div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>واحد سازمانی</th><th>نام افراد</th><th>تعداد</th></tr></thead>
      <tbody>${missingRows || '<tr><td colspan="3" class="empty-cell">همه پرسنل سفارش ثبت کرده‌اند</td></tr>'}</tbody>
    </table>
  </div>`;

  const monthlyBody = `
  <div class="sec-title">گزارش ماهیانه پرسنل — خلاصه وعده‌ها و هزینه</div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>#</th><th>نام و نام خانوادگی</th><th>واحد سازمانی</th><th>جمع وعده</th><th>جمع هزینه</th></tr></thead>
      <tbody>
        ${monthlyUserRows || '<tr><td colspan="5" class="empty-cell">سفارش تاییدشده‌ای ثبت نشده است</td></tr>'}
        ${monthlyUserRows ? `<tr class="total-row"><td colspan="3">جمع کل</td><td>${monthlyTotalCount.toLocaleString('fa-IR')}</td><td>${formatMoney(monthlyTotalPrice)}</td></tr>` : ''}
      </tbody>
    </table>
  </div>`;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: A4; margin: 14mm 12mm 18mm 12mm;
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
      font-size: 10pt;
      line-height: 1.6;
    }

    .letterhead {
      border: 1pt solid #000;
      margin-bottom: 14pt;
      page-break-inside: avoid;
    }
    .lh-top {
      border-bottom: 1pt solid #000;
      padding: 10pt 14pt;
      text-align: center;
    }
    .lh-org-main { font-size: 14pt; font-weight: 700; }
    .lh-org-sub  { font-size: 9pt; margin-top: 3pt; }
    .lh-meta {
      display: flex;
      border-bottom: 1pt solid #000;
    }
    .lh-cell {
      flex: 1; padding: 6pt 10pt;
      border-left: 1pt solid #000;
      font-size: 9pt;
    }
    .lh-cell:last-child { border-left: none; }
    .lh-cell-label { font-size: 8pt; margin-bottom: 2pt; }
    .lh-cell-val { font-weight: 700; }
    .lh-subject {
      padding: 6pt 14pt;
      font-size: 9.5pt;
    }
    .lh-subject-label { margin-left: 6pt; }
    .lh-subject-val { font-weight: 700; }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6pt; margin-bottom: 12pt;
      border: 1pt solid #000;
      padding: 8pt;
    }
    .stat { text-align: center; font-size: 9pt; }
    .stat-val { font-weight: 700; display: block; font-size: 11pt; }
    .stat-label { font-size: 8pt; }

    .sec-title {
      border: 1pt solid #000;
      border-bottom: none;
      font-size: 9.5pt; font-weight: 700;
      padding: 5pt 10pt;
      margin-top: 10pt;
    }

    .tbl-wrap { border: 1pt solid #000; margin-bottom: 10pt; }
    table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
    thead th {
      padding: 5pt 6pt; font-size: 8.5pt; font-weight: 700;
      text-align: right;
      border-bottom: 1pt solid #000;
      border-left: 1pt solid #ccc;
    }
    thead th:last-child { border-left: none; }
    tbody td {
      padding: 4pt 6pt; font-size: 8.5pt;
      border-bottom: 1pt solid #ddd;
      border-left: 1pt solid #eee;
      vertical-align: top;
    }
    tbody td:last-child { border-left: none; }
    tbody tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: 700; border-top: 1pt solid #000; }
    .empty-cell { text-align: center; padding: 8pt; }

    .sign-area {
      margin-top: 20pt; page-break-inside: avoid;
      border: 1pt solid #000;
    }
    .sign-head {
      border-bottom: 1pt solid #000;
      padding: 5pt 10pt; font-size: 9pt; font-weight: 700;
    }
    .sign-body {
      display: grid; grid-template-columns: repeat(4, 1fr);
      padding: 12pt 8pt 24pt;
    }
    .sign-col { border-left: 1pt dashed #999; padding: 0 8pt; text-align: center; }
    .sign-col:first-child { border-left: none; }
    .sign-col-title { font-size: 8.5pt; margin-bottom: 6pt; font-weight: 700; }
    .sign-col-name  { font-size: 9pt; margin-bottom: 6pt; }
    .sign-col-stamp {
      height: 30pt; border: 1pt dashed #999;
      width: 60pt; margin: 0 auto;
      display: flex; align-items: center; justify-content: center;
      font-size: 7pt; color: #666;
    }

    .doc-footer {
      margin-top: 14pt; padding-top: 6pt;
      border-top: 1pt solid #000;
      display: flex; justify-content: space-between;
      font-size: 7.5pt;
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
