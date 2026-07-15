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

function renderFinanceStatementHtml(report = {}) {
  const generatedAt = escapeHtml(formatJalaliDate(new Date()));
  const orgName = escapeHtml(report.organizationName || 'سامانه تغذیه سازمانی');
  const isMonthly = report.type === 'month';
  const split = report.split || {};
  const summary = report.summary || {};
  const users = report.users || [];

  const rows = users.map((user, index) => {
    const isGuest = user.kind === 'guest';
    const typeLabel = isGuest
      ? `مهمان ${user.guestTypeLabel || ''}`.trim()
      : 'پرسنل';
    const name = isGuest && user.guestCode
      ? `${user.fullName || '-'} (${user.guestCode})`
      : (user.fullName || '-');
    return `
    <tr>
      <td>${(index + 1).toLocaleString('fa-IR')}</td>
      <td class="num">${escapeHtml(user.statementNumber || '—')}</td>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(typeLabel)}</td>
      <td>${escapeHtml(user.department || '-')}</td>
      <td>${Number(user.mealCount || 0).toLocaleString('fa-IR')}</td>
      <td>${formatMoney(user.grossTotal)}</td>
      <td>${formatMoney(user.organizationAmount)}</td>
      <td>${formatMoney(user.personalAmount)}</td>
    </tr>`;
  }).join('');

  const subject = report.singleUser && report.selectedUser
    ? (report.selectedUser.kind === 'guest'
      ? `صورتحساب مهمان ${report.selectedUser.fullName}`
      : `صورتحساب ${report.selectedUser.fullName}`)
    : (isMonthly ? 'صورتحساب ماهیانه کاربران و مهمان‌ها' : 'صورتحساب هفتگی کاربران و مهمان‌ها');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Tahoma, Arial, sans-serif; color: #111; font-size: 9.5pt; margin: 0; }
    .letterhead { border: 1.2pt solid #000; margin-bottom: 10pt; }
    .lh-top { padding: 8pt 10pt; border-bottom: 1pt solid #000; text-align: center; }
    .lh-org-main { font-size: 13pt; font-weight: 800; }
    .lh-org-sub { font-size: 8.5pt; margin-top: 3pt; color: #333; }
    .lh-meta { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1pt solid #000; }
    .lh-cell { padding: 6pt 8pt; border-left: 1pt solid #000; }
    .lh-cell:last-child { border-left: none; }
    .lh-cell-label { font-size: 7.5pt; color: #444; margin-bottom: 2pt; }
    .lh-cell-val { font-size: 8.5pt; font-weight: 700; }
    .lh-subject { padding: 6pt 10pt; font-size: 9pt; }
    .lh-subject-label { font-weight: 700; }
    .summary-grid {
      display: grid; grid-template-columns: repeat(6, 1fr); gap: 6pt; margin: 10pt 0;
    }
    .summary-card {
      border: 1pt solid #bbb; padding: 7pt; border-radius: 4pt; background: #fafafa;
    }
    .summary-label { font-size: 7.5pt; color: #555; margin-bottom: 3pt; }
    .summary-value { font-size: 10pt; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; margin-top: 8pt; }
    th, td { border: 1pt solid #000; padding: 5pt 4pt; text-align: center; vertical-align: middle; }
    th { background: #2b1b3d; color: #fff; font-size: 8.5pt; }
    td.num { direction: ltr; font-weight: 700; }
    tr:nth-child(even) td { background: #f7f4fb; }
    .total-row td { background: #2b1b3d !important; color: #fff; font-weight: 800; }
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
      <div class="lh-org-sub">صورتحساب مالی ارسال‌شده به حسابداری</div>
    </div>
    <div class="lh-meta">
      <div class="lh-cell">
        <div class="lh-cell-label">شماره سند</div>
        <div class="lh-cell-val">${escapeHtml(report.reportNumber || '—')}</div>
      </div>
      <div class="lh-cell">
        <div class="lh-cell-label">تاریخ صدور</div>
        <div class="lh-cell-val">${generatedAt}</div>
      </div>
      <div class="lh-cell">
        <div class="lh-cell-label">بازه</div>
        <div class="lh-cell-val">${escapeHtml(report.range?.jalaliStart || '')} تا ${escapeHtml(report.range?.jalaliEnd || '')}</div>
      </div>
      <div class="lh-cell">
        <div class="lh-cell-label">نوع</div>
        <div class="lh-cell-val">${isMonthly ? 'ماهیانه' : 'هفتگی'}</div>
      </div>
    </div>
    <div class="lh-subject">
      <span class="lh-subject-label">موضوع:</span>
      <span class="lh-subject-val">${escapeHtml(subject)} — ${escapeHtml(report.title || '')}</span>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card"><div class="summary-label">کاربر</div><div class="summary-value">${Number(summary.userCount || 0).toLocaleString('fa-IR')}</div></div>
    <div class="summary-card"><div class="summary-label">مهمان</div><div class="summary-value">${Number(summary.guestCount || 0).toLocaleString('fa-IR')}</div></div>
    <div class="summary-card"><div class="summary-label">تعداد وعده</div><div class="summary-value">${Number(summary.mealCount || 0).toLocaleString('fa-IR')}</div></div>
    <div class="summary-card"><div class="summary-label">جمع کل</div><div class="summary-value">${formatMoney(summary.grossTotal)}</div></div>
    <div class="summary-card"><div class="summary-label">سهم سازمان (${Number(split.organizationSharePercent || 0).toLocaleString('fa-IR')}٪)</div><div class="summary-value">${formatMoney(summary.organizationAmount)}</div></div>
    <div class="summary-card"><div class="summary-label">سهم شخص (${Number(split.personalSharePercent || 0).toLocaleString('fa-IR')}٪)</div><div class="summary-value">${formatMoney(summary.personalAmount)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>ردیف</th>
        <th>شماره صورتحساب</th>
        <th>نام</th>
        <th>نوع</th>
        <th>واحد</th>
        <th>وعده</th>
        <th>مبلغ کل</th>
        <th>پرداختی سازمان</th>
        <th>پرداختی شخص</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="9">صورتحسابی ثبت نشده است</td></tr>'}
      <tr class="total-row">
        <td colspan="5">جمع کل</td>
        <td>${Number(summary.mealCount || 0).toLocaleString('fa-IR')}</td>
        <td>${formatMoney(summary.grossTotal)}</td>
        <td>${formatMoney(summary.organizationAmount)}</td>
        <td>${formatMoney(summary.personalAmount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="doc-footer">
    <span>تولید شده توسط سامانه مدیریت تغذیه — ${generatedAt}</span>
    <span>سهم سازمان ${Number(split.organizationSharePercent || 0).toLocaleString('fa-IR')}٪ / سهم شخص ${Number(split.personalSharePercent || 0).toLocaleString('fa-IR')}٪</span>
  </div>
</body>
</html>`;
}

module.exports = { renderFinanceStatementHtml };
