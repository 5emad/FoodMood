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
  return `${Number(value || 0).toLocaleString('fa-IR')} ت`;
}

function compactMoney(value) {
  return Number(value || 0).toLocaleString('fa-IR');
}

function renderFoodCell(foods, categories = []) {
  if (!foods?.length) return '<span class="food-empty">-</span>';
  const map = new Map();
  for (const food of foods) {
    const key = foodCategoryOf(food);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(food);
  }
  const orderedKeys = [];
  for (const cat of categories || []) {
    const k = normalizeCategoryKey(cat.key);
    if (map.has(k)) orderedKeys.push(k);
  }
  for (const k of map.keys()) {
    if (!orderedKeys.includes(k)) orderedKeys.push(k);
  }
  const multi = orderedKeys.length > 1;
  return orderedKeys.map((key) => {
    const items = (map.get(key) || []).map((food) => {
      const label = food && typeof food === 'object' ? (food.name || '-') : food;
      return `<div class="food-item">${escapeHtml(label)}</div>`;
    }).join('');
    if (!multi) return items;
    return `<div class="food-cat-group"><div class="food-cat-label">${escapeHtml(categoryLabel(categories, key))}</div>${items}</div>`;
  }).join('');
}

function normalizeCategoryKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return key || 'uncategorized';
}

function categoryLabel(categories, key) {
  const k = normalizeCategoryKey(key);
  const hit = (categories || []).find((c) => normalizeCategoryKey(c.key) === k);
  if (hit?.name) return hit.name;
  const fallback = { lunch: 'ناهار', breakfast: 'صبحانه', dinner: 'شام', snack: 'میان وعده', uncategorized: 'بدون دسته' };
  return fallback[k] || k;
}

function foodCategoryOf(food) {
  if (food && typeof food === 'object') return normalizeCategoryKey(food.category);
  return 'uncategorized';
}

function groupFoodsByCategory(foods, categories = []) {
  const map = new Map();
  for (const food of foods || []) {
    const key = normalizeCategoryKey(food.category);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(food);
  }
  const orderedKeys = [];
  for (const cat of categories || []) {
    const k = normalizeCategoryKey(cat.key);
    if (map.has(k)) orderedKeys.push(k);
  }
  for (const k of map.keys()) {
    if (!orderedKeys.includes(k)) orderedKeys.push(k);
  }
  return orderedKeys.map((key) => ({
    key,
    name: categoryLabel(categories, key),
    items: map.get(key) || [],
  }));
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

/** غذای غالب یک کاربر در هفته */
function userPrimaryFoodName(user) {
  const counts = new Map();
  for (const day of user.days || []) {
    for (const food of day.foods || []) {
      const name = food && typeof food === 'object' ? (food.name || '') : String(food || '');
      if (name && name !== '-') counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  if (!counts.size) return '\uFFFF';
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fa'))[0][0];
}

function userPrimaryCategory(user) {
  const counts = new Map();
  for (const day of user.days || []) {
    for (const food of day.foods || []) {
      const cat = foodCategoryOf(food);
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
  }
  if (!counts.size) return '\uFFFF';
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fa'))[0][0];
}

function sortUsersByFoodThenName(users, categories = []) {
  const orderIndex = new Map(
    (categories || []).map((c, i) => [normalizeCategoryKey(c.key), Number(c.sortOrder ?? i)]),
  );
  return users.slice().sort((a, b) => {
    const ca = userPrimaryCategory(a);
    const cb = userPrimaryCategory(b);
    const oa = orderIndex.has(ca) ? orderIndex.get(ca) : 999;
    const ob = orderIndex.has(cb) ? orderIndex.get(cb) : 999;
    if (oa !== ob) return oa - ob;
    if (ca !== cb) return ca.localeCompare(cb, 'fa');
    const foodCmp = userPrimaryFoodName(a).localeCompare(userPrimaryFoodName(b), 'fa');
    if (foodCmp !== 0) return foodCmp;
    return String(a.fullName || '').localeCompare(String(b.fullName || ''), 'fa');
  });
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
  const categories = report.categories || [];
  const dayCount = report.byGuest?.[0]?.days?.length || report.byUser[0]?.days?.length || report.days?.length || 0;
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
      ${guest.days.map((day) => `<td class="col-day">${renderFoodCell(day.foods, categories)}</td>`).join('')}
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
  const generatedAt = escapeHtml(formatJalaliDate(new Date()));
  const orgName = escapeHtml(report.organizationName || 'سامانه تغذیه سازمانی');
  const categories = report.categories || [];
  const dayCount = report.days?.length || report.byUser[0]?.days?.length || report.byGuest?.[0]?.days?.length || 0;
  const weeklySecTitle = 'گزارش پرسنلی — تفکیک روزانه سفارشات هفته';

  const daySource = report.days?.length
    ? report.days
    : (report.byUser[0]?.days || report.byGuest?.[0]?.days || []);
  const userDayHeaders = daySource.map((day) => `<th class="col-day">${escapeHtml(day.jalaliDate)}</th>`).join('');
  let rowIndex = 0;
  const userDeptBlocks = groupUsersByDepartment(report.byUser).map(([department, users]) => {
    const sorted = sortUsersByFoodThenName(users, categories);
    const colSpan = dayCount + 5;
    const body = sorted.map((user) => {
      rowIndex += 1;
      return `
    <tr>
      <td class="col-idx">${rowIndex.toLocaleString('fa-IR')}</td>
      <td class="col-name">${escapeHtml(user.fullName)}</td>
      <td class="col-dept">${escapeHtml(user.department)}</td>
      ${user.days.map((day) => `<td class="col-day">${renderFoodCell(day.foods, categories)}</td>`).join('')}
      <td class="col-total">${Number(user.total || 0).toLocaleString('fa-IR')}</td>
      <td class="col-price" title="${formatMoney(user.totalPrice)}">${compactMoney(user.totalPrice)}</td>
    </tr>`;
    }).join('');
    return `
  <div class="dept-block">
    <div class="tbl-wrap wide">
      <table class="report-grid">
        ${buildWeeklyColgroup(dayCount)}
        <thead><tr><th class="col-idx">#</th><th class="col-name">نام و نام خانوادگی</th><th class="col-dept">واحد</th>${userDayHeaders}<th class="col-total">جمع وعده</th><th class="col-price">هزینه (ت)</th></tr></thead>
        <tbody>
          <tr class="dept-group-row"><td colspan="${colSpan}">${escapeHtml(department)} (${sorted.length.toLocaleString('fa-IR')} نفر)</td></tr>
          ${body || `<tr><td colspan="${colSpan}" class="empty-cell">—</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
  }).join('');
  const userRows = userDeptBlocks;
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

  const guestWeekly = renderGuestWeeklyRows(report);
  const weeklyBody = `
  <div class="stats stats-weekly">
    <div class="stat"><span class="stat-val">${report.totals.totalOrders.toLocaleString('fa-IR')}</span> <span class="stat-label">سفارش تاییدشده</span></div>
    <div class="stat"><span class="stat-val">${(report.totals.totalMeals || report.totals.totalOrders || 0).toLocaleString('fa-IR')}</span> <span class="stat-label">جمع وعده</span></div>
    <div class="stat"><span class="stat-val">${compactMoney(report.totals.totalPrice)}</span> <span class="stat-label">مبلغ کل (ت)</span></div>
  </div>

  <div class="sec-title">${weeklySecTitle}</div>
  ${userRows || `<div class="tbl-wrap wide"><table class="report-grid"><tbody><tr><td class="empty-cell">سفارش تاییدشده‌ای ثبت نشده است</td></tr></tbody></table></div>`}

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
    const foodGroups = groupFoodsByCategory(report.byFood || [], categories);
    if (!foodGroups.length) return '';
    let foodIndex = 0;
    const foodRows = foodGroups.flatMap((group) => [
      `<tr class="dept-group-row"><td colspan="4">${escapeHtml(group.name)}</td></tr>`,
      ...group.items.map((food) => {
        foodIndex += 1;
        return `<tr>
          <td>${foodIndex.toLocaleString('fa-IR')}</td>
          <td class="col-name">${escapeHtml(food.foodName)}</td>
          <td class="col-total">${Number(food.count || 0).toLocaleString('fa-IR')}</td>
          <td class="col-price">${compactMoney(food.totalPrice)}</td>
        </tr>`;
      }),
    ]).join('');
    return `
  <div class="sec-title">خلاصه غذاها بر اساس دسته</div>
  <div class="tbl-wrap">
    <table class="report-grid monthly-grid">
      <thead><tr><th>#</th><th class="col-name">نام غذا</th><th class="col-total">جمع وعده</th><th class="col-price">هزینه (ت)</th></tr></thead>
      <tbody>${foodRows}</tbody>
    </table>
  </div>`;
  })()}

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
        font-family: var(--report-font-family, 'Vazirmatn', Tahoma, sans-serif);
        font-size: 8pt; color: #444; direction: rtl;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--report-font-family, 'Vazirmatn', Tahoma, sans-serif);
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
      background: #f3f3f3;
      font-weight: 700;
      padding: 4pt 6pt;
      page-break-after: avoid;
    }
    .dept-block {
      page-break-inside: auto;
      break-inside: auto;
      margin-bottom: 8pt;
    }
    .dept-block + .dept-block {
      page-break-before: auto;
    }
    .col-idx, .col-total, .col-price { text-align: center; white-space: nowrap; }
    .col-price { direction: ltr; font-size: 7pt; }
    .col-name, .col-dept { text-align: right; }
    .col-day { font-size: 6.8pt; line-height: 1.25; }
    .food-item { margin-bottom: 1.5pt; }
    .food-item:last-child { margin-bottom: 0; }
    .food-cat-group { margin-bottom: 3pt; }
    .food-cat-group:last-child { margin-bottom: 0; }
    .food-cat-label { font-size: 7.5pt; font-weight: 700; margin-bottom: 1pt; }
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

function foodNameOf(food) {
  if (food && typeof food === 'object') return food.name || '';
  return String(food || '');
}

/** درخت یک روز: دسته → واحد → غذا → افراد */
function buildCategoryFoodTreeFromEntries(entries, categories = []) {
  const catMap = new Map();
  for (const { foodName, category, department, fullName } of entries) {
    const food = String(foodName || '').trim();
    if (!food || food === '-') continue;
    const catKey = normalizeCategoryKey(category);
    const dept = department || 'بدون واحد';
    const name = fullName || '—';
    if (!catMap.has(catKey)) catMap.set(catKey, { key: catKey, depts: new Map() });
    const catRow = catMap.get(catKey);
    if (!catRow.depts.has(dept)) catRow.depts.set(dept, { department: dept, foods: new Map() });
    const deptRow = catRow.depts.get(dept);
    if (!deptRow.foods.has(food)) deptRow.foods.set(food, { foodName: food, total: 0, people: new Map() });
    const foodRow = deptRow.foods.get(food);
    foodRow.total += 1;
    const person = foodRow.people.get(name) || { fullName: name, count: 0 };
    person.count += 1;
    foodRow.people.set(name, person);
  }

  const ordered = [];
  for (const cat of categories || []) {
    const k = normalizeCategoryKey(cat.key);
    if (catMap.has(k)) ordered.push(k);
  }
  for (const k of catMap.keys()) {
    if (!ordered.includes(k)) ordered.push(k);
  }

  return ordered.map((key) => {
    const catRow = catMap.get(key);
    const departments = [...catRow.depts.values()]
      .map((dept) => {
        const foods = [...dept.foods.values()]
          .map((food) => ({
            foodName: food.foodName,
            total: food.total,
            people: [...food.people.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa')),
          }))
          .sort((a, b) => a.foodName.localeCompare(b.foodName, 'fa'));
        return {
          department: dept.department,
          foods,
          rowCount: Math.max(foods.length, 1),
          total: foods.reduce((s, f) => s + f.total, 0),
        };
      })
      .sort((a, b) => a.department.localeCompare(b.department, 'fa'));
    return {
      key,
      name: categoryLabel(categories, key),
      departments,
      total: departments.reduce((s, d) => s + d.total, 0),
      foodCount: departments.reduce((s, d) => s + d.foods.length, 0),
      rowCount: Math.max(departments.reduce((s, d) => s + d.rowCount, 0), 1),
    };
  });
}

function normPersonnel2DayKey(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u00a0]/g, '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/-/g, '/')
    .trim();
}

function buildPersonnel2ByDay(report) {
  const dayOrder = [];
  const dayMap = new Map();
  const dayLabel = new Map();
  const categories = report.categories || [];

  const ensureDay = (jalaliDate) => {
    const display = String(jalaliDate || '').trim() || '—';
    const key = normPersonnel2DayKey(display) || '—';
    if (!dayMap.has(key)) {
      dayMap.set(key, []);
      dayOrder.push(key);
      dayLabel.set(key, display);
    }
    return dayMap.get(key);
  };

  for (const d of report.days || []) {
    if (d?.jalaliDate) ensureDay(d.jalaliDate);
  }
  for (const d of report.byDayPrep || []) {
    if (d?.jalaliDate) ensureDay(d.jalaliDate);
  }

  for (const user of report.byUser || []) {
    for (const day of user.days || []) {
      for (const food of day.foods || []) {
        const name = foodNameOf(food).trim();
        if (!name || name === '-') continue;
        ensureDay(day.jalaliDate).push({
          foodName: name,
          category: foodCategoryOf(food),
          department: user.department || 'بدون واحد',
          fullName: user.fullName || '—',
        });
      }
    }
  }
  for (const guest of report.byGuest || []) {
    for (const day of guest.days || []) {
      for (const food of day.foods || []) {
        const name = foodNameOf(food).trim();
        if (!name || name === '-') continue;
        ensureDay(day.jalaliDate).push({
          foodName: name,
          category: foodCategoryOf(food),
          department: guest.department || 'مهمان',
          fullName: `${guest.fullName || '—'} (مهمان)`,
        });
      }
    }
  }

  return dayOrder
    .map((key) => {
      const cats = buildCategoryFoodTreeFromEntries(dayMap.get(key) || [], categories);
      const total = cats.reduce((s, c) => s + c.total, 0);
      const foodCount = cats.reduce((s, c) => s + (c.foodCount || 0), 0);
      return { jalaliDate: dayLabel.get(key) || key, categories: cats, total, foodCount };
    })
    .filter((day) => day.categories.length > 0);
}

function renderDayTableRows(day) {
  const rows = [];
  for (const cat of day.categories) {
    let catRendered = false;
    for (const dept of cat.departments || []) {
      let deptRendered = false;
      const foods = dept.foods?.length ? dept.foods : [{ foodName: '—', people: [] }];
      for (const food of foods) {
        const people = food.people?.length ? food.people : [{ fullName: '—', count: 0 }];
        const namesLabel = people
          .map((person) => {
            const countTxt = person.count > 1 ? ` (${person.count.toLocaleString('fa-IR')})` : '';
            return `${escapeHtml(person.fullName)}${countTxt}`;
          })
          .join('، ');
        const catCell = !catRendered
          ? `<td class="col-cat" rowspan="${cat.rowCount}">${escapeHtml(cat.name)}</td>`
          : '';
        const deptCell = !deptRendered
          ? `<td class="col-dept" rowspan="${dept.rowCount}">${escapeHtml(dept.department)}</td>`
          : '';
        rows.push(`
          <tr>
            ${catCell}
            ${deptCell}
            <td class="col-food">${escapeHtml(food.foodName)}</td>
            <td class="col-name">${namesLabel || '—'}</td>
          </tr>`);
        catRendered = true;
        deptRendered = true;
      }
    }
  }
  return rows.join('');
}

function renderPersonnel2ReportHtml(report) {
  const generatedAt = escapeHtml(formatJalaliDate(new Date()));
  const orgName = escapeHtml(report.organizationName || 'سامانه تغذیه سازمانی');
  const days = buildPersonnel2ByDay(report);
  const totalMeals = days.reduce((sum, day) => sum + day.total, 0);

  const daySections = days.map((day) => `
    <section class="day-block">
      <div class="day-head">
        <span class="day-title">${escapeHtml(day.jalaliDate)}</span>
        <span class="day-meta">${day.total.toLocaleString('fa-IR')} پرس · ${day.foodCount.toLocaleString('fa-IR')} غذا</span>
      </div>
      <table class="p2">
        <thead>
          <tr>
            <th>دسته</th>
            <th>واحد</th>
            <th>غذاها</th>
            <th>نام و نام خانوادگی</th>
          </tr>
        </thead>
        <tbody>${renderDayTableRows(day)}</tbody>
      </table>
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(report.title || 'گزارش پرسنلی ۲')}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: var(--report-font-family, 'Vazirmatn', Tahoma, sans-serif);
      font-size: 8.5pt; color: #000; direction: rtl;
    }
    .head {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 8pt; border-bottom: 1pt solid #000; padding-bottom: 4pt; margin-bottom: 6pt;
    }
    .head-title { font-size: 11pt; font-weight: 700; }
    .head-meta { font-size: 7.5pt; text-align: left; line-height: 1.35; }
    .day-block { margin-bottom: 6pt; }
    .day-head {
      display: flex; justify-content: space-between; align-items: center;
      gap: 6pt; padding: 3pt 6pt; margin-bottom: 0;
      border: 0.7pt solid #000; border-bottom: none; background: #e8e8e8;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .day-title { font-size: 9pt; font-weight: 700; }
    .day-meta { font-size: 7pt; white-space: nowrap; }
    table.p2 {
      width: 100%; border-collapse: collapse; table-layout: fixed;
    }
    table.p2 th, table.p2 td {
      border: 0.7pt solid #000; padding: 2.5pt 4pt; vertical-align: middle;
    }
    table.p2 th {
      background: #eee; font-weight: 700; text-align: center; font-size: 8pt;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    table.p2 thead { display: table-header-group; }
    table.p2 tr { page-break-inside: avoid; }
    .col-cat { width: 8%; text-align: center; font-weight: 700; background: #f0f0f0; font-size: 7.5pt; }
    .col-dept { width: 10%; text-align: center; font-weight: 700; background: #fafafa; font-size: 7.5pt; }
    .col-food { width: 12%; text-align: center; font-weight: 700; background: #f5f5f5; font-size: 8pt; }
    .col-name { width: 70%; text-align: right; font-weight: 600; font-size: 8pt; line-height: 1.4; word-break: break-word; overflow-wrap: anywhere; }
    .empty { text-align: center; padding: 12pt; border: 1pt solid #000; }
    .foot {
      margin-top: 6pt; padding-top: 4pt; border-top: 0.7pt solid #000;
      font-size: 7.5pt; display: flex; justify-content: space-between; gap: 6pt;
    }
  </style>
</head>
<body>
  <div class="head">
    <div class="head-title">گزارش پرسنلی ۲ — ${orgName}</div>
    <div class="head-meta">
      <div>${escapeHtml(report.range?.jalaliStart || '—')} تا ${escapeHtml(report.range?.jalaliEnd || '—')}</div>
      <div>${generatedAt}</div>
    </div>
  </div>
  ${daySections || '<div class="empty">سفارش تاییدشده‌ای ثبت نشده است</div>'}
  <div class="foot">
    <span>جمع هفته: ${totalMeals.toLocaleString('fa-IR')} پرس در ${days.length.toLocaleString('fa-IR')} روز</span>
    <span>${escapeHtml(report.reportNumber || '')}</span>
  </div>
</body>
</html>`;
}

module.exports = { renderReportHtml, renderPersonnel2ReportHtml };

