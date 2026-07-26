import { compactMoney, faDigits, money, tomanLabel } from '../../../utils/format';
import { categoryLabel, groupItemsByCategory, normalizeCategoryKey } from '../../../lib/foodCategories';
import EmptyState from '../shared/EmptyState';

function groupByDepartment(users) {
  const map = new Map();
  (users || []).forEach((u) => {
    const dept = u.department || 'بدون واحد';
    if (!map.has(dept)) map.set(dept, []);
    map.get(dept).push(u);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fa'));
}

function foodLabel(food) {
  if (food && typeof food === 'object') return food.name || '-';
  return food || '-';
}

function foodCategoryOf(food) {
  if (food && typeof food === 'object') return normalizeCategoryKey(food.category);
  return 'uncategorized';
}

function reportCategories(report) {
  return report?.categories || [];
}

/** غذای غالب یک کاربر در هفته (برای مرتب‌سازی گزارش) */
function userPrimaryFoodName(user) {
  const counts = new Map();
  for (const day of user.days || []) {
    for (const food of day.foods || []) {
      const name = foodLabel(food);
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

/** در هر واحد: دسته غالب → غذای غالب → نام */
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

function DayFoodsCell({ foods, categories }) {
  const list = foods || [];
  if (!list.length) return <span className="report-food-empty">-</span>;
  const groups = groupItemsByCategory(list, foodCategoryOf, categories);
  const multi = groups.length > 1;
  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="report-cat-group">
          {multi ? <div className="report-cat-label">{group.name}</div> : null}
          {group.items.map((food, i) => (
            <div key={`${group.key}-${i}`} className="report-food-item">{foodLabel(food)}</div>
          ))}
        </div>
      ))}
    </>
  );
}

export function MissingUsersTable({ report }) {
  const missing = report?.missingUsers || {};
  const entries = Object.entries(missing)
    .map(([dept, names]) => [dept, (names || []).filter((n) => String(n || '').toLowerCase() !== 'superadmin')])
    .filter(([, names]) => names.length);
  if (!entries.length) return null;
  const totalMissing = entries.reduce((sum, [, names]) => sum + names.length, 0);

  return (
    <div className="card no-order-card mt-3">
      <div className="card-header">
        <div className="card-title"><i className="fas fa-user-slash" style={{ marginLeft: 8, color: 'var(--danger)' }} /> افراد بدون سفارش</div>
        <span className="badge badge-danger">{faDigits(totalMissing)} نفر</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0, background: 'transparent' }}>
          <table className="report-table no-order-table">
            <thead><tr><th style={{ textAlign: 'right' }}>نام فرد</th><th>واحد</th></tr></thead>
            <tbody>
              {entries.sort((a, b) => a[0].localeCompare(b[0], 'fa')).flatMap(([dept, names]) => {
                const sorted = names.slice().sort((a, b) => String(a).localeCompare(String(b), 'fa'));
                return [
                  <tr key={`dept-${dept}`} className="dept-group-row">
                    <td colSpan={2} style={{ background: 'var(--primary-bg)', fontWeight: 800, textAlign: 'right', padding: '10px 12px' }}>
                      {dept} <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '.82rem' }}>({faDigits(sorted.length)} نفر)</span>
                    </td>
                  </tr>,
                  ...sorted.map((name) => (
                    <tr key={`${dept}-${name}`}>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{name}</td>
                      <td>{dept}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function GuestWeeklyReport({ report }) {
  const byGuest = report?.byGuest || [];
  if (!byGuest.length) return null;
  const reportDays = report.days || byGuest[0]?.days || [];
  const categories = reportCategories(report);
  return (
    <div className="card mt-3">
      <div className="card-header">
        <div className="card-title"><i className="fas fa-user-tag" style={{ marginLeft: 8, color: 'var(--primary)' }} /> گزارش مهمان‌ها</div>
        <span className="badge badge-primary">{faDigits(byGuest.length)} مهمان</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <div className="table-wrap report-table-scroll" style={{ border: 'none', borderRadius: 0, background: 'transparent' }}>
          <table className="report-table report-table-wide">
            <thead>
              <tr>
                <th>کد مهمان</th>
                <th className="col-name" style={{ textAlign: 'right' }}>نام مهمان</th>
                <th>نوع</th>
                {reportDays.map((d) => <th key={d.jalaliDate}>{d.jalaliDate}</th>)}
                <th className="col-total">جمع وعده</th>
                <th className="col-price">{`هزینه (${tomanLabel()})`}</th>
              </tr>
            </thead>
            <tbody>
              {byGuest.map((guest) => (
                <tr key={guest.guestCode}>
                  <td><span className="guest-code-badge">{guest.guestCode}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{guest.fullName}</td>
                  <td>{guest.guestTypeLabel || (guest.guestType === 'permanent' ? 'دائم' : 'موقت')}</td>
                  {reportDays.map((reportDay) => {
                    const day = (guest.days || []).find((d) => d.jalaliDate === reportDay.jalaliDate);
                    if (!day?.foods?.length) return <td key={reportDay.jalaliDate} className="report-day-cell">-</td>;
                    return (
                      <td key={reportDay.jalaliDate} className="report-day-cell">
                        <DayFoodsCell foods={day.foods} categories={categories} />
                      </td>
                    );
                  })}
                  <td className="col-total"><strong>{faDigits(guest.total)}</strong></td>
                  <td className="col-price" title={money(guest.totalPrice)}>{compactMoney(guest.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function WeeklyPersonnelReport({ report }) {
  if (!report) return null;
  const byUser = report.byUser || [];
  const reportDays = report.days || byUser[0]?.days || [];
  const categories = reportCategories(report);
  const groups = groupByDepartment(byUser);
  const hasMain = byUser.length > 0;
  const hasMissing = Object.values(report.missingUsers || {}).some((names) => (names || []).length);
  const hasGuest = (report.byGuest || []).length > 0;

  if (!hasMain && !hasMissing && !hasGuest) {
    return <div className="empty-state"><p>برای این هفته سفارشی ثبت نشده است.</p></div>;
  }

  return (
    <>
      {hasMain ? (
        <div className="report-dept-stack">
          {groups.map(([dept, users]) => {
            const sorted = sortUsersByFoodThenName(users, categories);
            const large = sorted.length > 18;
            return (
              <div key={dept} className={`report-dept-block${large ? ' is-large' : ''}`}>
                <div className="table-wrap report-table-scroll">
                  <table className="report-table report-table-wide">
                    <thead>
                      <tr>
                        <th className="col-name" style={{ textAlign: 'right' }}>نام فرد</th>
                        <th>واحد</th>
                        {reportDays.map((d) => <th key={d.jalaliDate}>{d.jalaliDate}</th>)}
                        <th className="col-total">جمع وعده</th>
                        <th className="col-price">{`هزینه (${tomanLabel()})`}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="dept-group-row">
                        <td colSpan={reportDays.length + 4} style={{ background: 'var(--primary-bg)', fontWeight: 800, textAlign: 'right', padding: '10px 12px' }}>
                          {dept} <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '.82rem' }}>({faDigits(sorted.length)} نفر)</span>
                        </td>
                      </tr>
                      {sorted.map((u) => (
                        <tr key={u.fullName + u.department}>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{u.fullName}</td>
                          <td>{u.department}</td>
                          {reportDays.map((reportDay) => {
                            const day = (u.days || []).find((d) => d.jalaliDate === reportDay.jalaliDate);
                            if (!day?.foods?.length) return <td key={reportDay.jalaliDate} className="report-day-cell">-</td>;
                            return (
                              <td key={reportDay.jalaliDate} className="report-day-cell">
                                <DayFoodsCell foods={day.foods} categories={categories} />
                              </td>
                            );
                          })}
                          <td className="col-total"><strong>{faDigits(u.total)}</strong></td>
                          <td className="col-price" title={money(u.totalPrice)}>{compactMoney(u.totalPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state"><p>برای این بازه سفارشی ثبت نشده است.</p></div>
      )}
      <MissingUsersTable report={report} />
      <GuestWeeklyReport report={report} />
    </>
  );
}

/** درخت یک روز: دسته → غذا → واحد → افراد */
function buildCategoryFoodTreeFromEntries(entries, categories = []) {
  const catMap = new Map();
  for (const { foodName, category, department, fullName } of entries) {
    const food = String(foodName || '').trim();
    if (!food || food === '-') continue;
    const catKey = normalizeCategoryKey(category);
    const dept = department || 'بدون واحد';
    const name = fullName || '—';
    if (!catMap.has(catKey)) {
      catMap.set(catKey, { key: catKey, foods: new Map() });
    }
    const catRow = catMap.get(catKey);
    if (!catRow.foods.has(food)) catRow.foods.set(food, { foodName: food, total: 0, depts: new Map() });
    const foodRow = catRow.foods.get(food);
    foodRow.total += 1;
    if (!foodRow.depts.has(dept)) foodRow.depts.set(dept, { department: dept, people: new Map() });
    const deptRow = foodRow.depts.get(dept);
    const person = deptRow.people.get(name) || { fullName: name, count: 0 };
    person.count += 1;
    deptRow.people.set(name, person);
  }

  const ordered = groupItemsByCategory(
    [...catMap.keys()].map((key) => ({ category: key })),
    (x) => x.category,
    categories,
  ).map((g) => g.key);

  for (const key of catMap.keys()) {
    if (!ordered.includes(key)) ordered.push(key);
  }

  return ordered
    .filter((key) => catMap.has(key))
    .map((key) => {
      const catRow = catMap.get(key);
      const foods = [...catRow.foods.values()]
        .map((food) => {
          const departments = [...food.depts.values()]
            .map((dept) => ({
              department: dept.department,
              people: [...dept.people.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa')),
            }))
            .sort((a, b) => a.department.localeCompare(b.department, 'fa'));
          // یک سطر به ازای هر واحد — نام‌ها کنار هم در همان سلول
          const rowCount = Math.max(departments.length, 1);
          return {
            foodName: food.foodName,
            total: food.total,
            departments,
            rowCount,
          };
        })
        .sort((a, b) => a.foodName.localeCompare(b.foodName, 'fa'));
      const rowCount = foods.reduce((s, f) => s + f.rowCount, 0);
      const total = foods.reduce((s, f) => s + f.total, 0);
      return {
        key,
        name: categoryLabel(categories, key),
        foods,
        total,
        rowCount,
      };
    });
}

/** گزارش پرسنلی ۲ — تفکیک روزهای هفته فعال */
export function buildPersonnel2ByDay(report) {
  const dayOrder = [];
  const dayMap = new Map();
  const categories = reportCategories(report);

  const ensureDay = (jalaliDate) => {
    const key = String(jalaliDate || '').trim() || '—';
    if (!dayMap.has(key)) {
      dayMap.set(key, []);
      dayOrder.push(key);
    }
    return dayMap.get(key);
  };

  for (const d of (report?.days || [])) {
    if (d?.jalaliDate) ensureDay(d.jalaliDate);
  }

  for (const u of (report?.byUser || [])) {
    for (const day of u.days || []) {
      for (const food of day.foods || []) {
        const name = foodLabel(food);
        if (!name || name === '-') continue;
        ensureDay(day.jalaliDate).push({
          foodName: name,
          category: foodCategoryOf(food),
          department: u.department || 'بدون واحد',
          fullName: u.fullName || '—',
        });
      }
    }
  }
  for (const g of report?.byGuest || []) {
    for (const day of g.days || []) {
      for (const food of day.foods || []) {
        const name = foodLabel(food);
        if (!name || name === '-') continue;
        ensureDay(day.jalaliDate).push({
          foodName: name,
          category: foodCategoryOf(food),
          department: g.department || 'مهمان',
          fullName: `${g.fullName || '—'} (مهمان)`,
        });
      }
    }
  }

  return dayOrder
    .map((jalaliDate) => {
      const cats = buildCategoryFoodTreeFromEntries(dayMap.get(jalaliDate) || [], categories);
      const total = cats.reduce((s, c) => s + c.total, 0);
      const foodCount = cats.reduce((s, c) => s + c.foods.length, 0);
      return { jalaliDate, categories: cats, total, foodCount };
    })
    .filter((day) => day.categories.length > 0);
}

/** ردیف‌های جدول با rowspan برای دسته و غذا؛ افراد یک واحد در یک سلول */
export function buildPersonnel2TableRows(tree, keyPrefix = '') {
  const rows = [];
  for (const cat of tree) {
    let catRendered = false;
    for (const food of cat.foods) {
      let foodRendered = false;
      for (const dept of food.departments) {
        const people = dept.people.length ? dept.people : [{ fullName: '—', count: 0 }];
        const namesLabel = people
          .map((person) => (
            person.count > 1
              ? `${person.fullName} (${faDigits(person.count)})`
              : person.fullName
          ))
          .join('، ');
        rows.push({
          key: `${keyPrefix}${cat.key}|${food.foodName}|${dept.department}`,
          showCategory: !catRendered,
          categoryRowSpan: cat.rowCount,
          categoryName: cat.name,
          showFood: !foodRendered,
          foodRowSpan: food.rowCount,
          foodName: food.foodName,
          showDept: true,
          deptRowSpan: 1,
          department: dept.department,
          fullName: namesLabel,
          count: 0,
        });
        catRendered = true;
        foodRendered = true;
      }
    }
  }
  return rows;
}

/** گزارش پرسنلی ۲ — هر روز جدا، سپس دسته / غذا / واحد / نام */
export function WeeklyPersonnelByFoodReport({ report }) {
  if (!report) return null;

  const days = buildPersonnel2ByDay(report);
  if (!days.length) {
    return <EmptyState icon="fa-utensils" title="سفارشی برای این هفته نیست" desc="پس از ثبت و تایید سفارش‌ها، غذاهای هر روز هفته اینجا به تفکیک نمایش داده می‌شود." />;
  }

  const totalMeals = days.reduce((s, d) => s + d.total, 0);

  return (
    <div className="personnel2-print">
      {days.map((day) => {
        const rows = buildPersonnel2TableRows(day.categories, `${day.jalaliDate}|`);
        return (
          <section key={day.jalaliDate} className="personnel2-day-block">
            <header className="personnel2-day-head">
              <span className="personnel2-day-title">{day.jalaliDate}</span>
              <span className="personnel2-day-meta">{faDigits(day.total)} پرس · {faDigits(day.foodCount)} غذا</span>
            </header>
            <div className="table-wrap personnel2-table-wrap">
              <table className="report-table personnel2-table">
                <colgroup>
                  <col className="personnel2-col-cat" />
                  <col className="personnel2-col-food" />
                  <col className="personnel2-col-dept" />
                  <col className="personnel2-col-name" />
                </colgroup>
                <thead>
                  <tr>
                    <th>دسته</th>
                    <th>غذاها</th>
                    <th>واحد</th>
                    <th className="col-name">نام و نام خانوادگی</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      {row.showCategory && (
                        <td className="personnel2-cat" rowSpan={row.categoryRowSpan}>{row.categoryName}</td>
                      )}
                      {row.showFood && (
                        <td className="personnel2-food" rowSpan={row.foodRowSpan}>{row.foodName}</td>
                      )}
                      {row.showDept && (
                        <td className="personnel2-dept" rowSpan={row.deptRowSpan}>{row.department}</td>
                      )}
                      <td className="col-name personnel2-name">
                        {row.fullName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <div className="personnel2-footer no-print">
        جمع هفته: {faDigits(totalMeals)} پرس در {faDigits(days.length)} روز
      </div>
    </div>
  );
}

function foodsGroupedForPrep(foods, categories) {
  return groupItemsByCategory(foods || [], (f) => f.category, categories);
}

export function DailyStatsGrid({ report }) {
  const days = report?.byDayPrep || [];
  const categories = reportCategories(report);
  if (!days.some((d) => (d.foods || []).length)) return <div className="daily-stats-grid" id="dailyStatsGrid" />;
  return (
    <div className="daily-stats-grid" id="dailyStatsGrid">
      {days.map((day) => {
        const groups = foodsGroupedForPrep(day.foods, categories);
        return (
          <div key={day.jalaliDate} className={`dsc${(day.foods || []).length ? '' : ' is-empty'}`}>
            <div className="dsc-head">{day.jalaliDate}</div>
            <div className="dsc-body">
              {groups.length
                ? groups.map((group) => (
                  <div key={group.key} className="dsc-cat-block">
                    <div className="dsc-cat-title">{group.name}</div>
                    {group.items.map((food, i) => (
                      <div key={`${group.key}-${i}`} className="dsc-row">
                        <span className="dsc-food-name" title={food.foodName}>{food.foodName}</span>
                        <strong className="dsc-food-count">{faDigits(food.count)}</strong>
                      </div>
                    ))}
                  </div>
                ))
                : <div className="dsc-empty">بدون سفارش</div>}
            </div>
            <div className="dsc-total">جمع: {faDigits(day.totalMeals)} پرس</div>
            <div className="dsc-split">پرسنل: {faDigits(day.userMeals)} — مهمان: {faDigits(day.guestMeals)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function SupplierReportView({ report }) {
  const days = report?.byDayPrep || [];
  const totals = report?.prepTotals || { totalMeals: 0, userMeals: 0, guestMeals: 0 };
  const categories = reportCategories(report);
  const hasMeals = days.some((day) => (day.foods || []).length > 0);

  if (!hasMeals) {
    return (
      <div id="supplierReportWrap">
        <EmptyState icon="fa-kitchen-set" title="سفارش تاییدشده‌ای برای این هفته نیست" desc="پس از تایید سفارش‌های پرسنل و مهمان، تعداد پرس‌ها اینجا نمایش داده می‌شود." />
      </div>
    );
  }

  return (
    <div id="supplierReportWrap">
      <div className="supplier-summary-grid no-print">
        <div className="supplier-summary-card"><span className="supplier-summary-val">{faDigits(totals.totalMeals)}</span><span className="supplier-summary-label">جمع کل پرس</span></div>
        <div className="supplier-summary-card"><span className="supplier-summary-val">{faDigits(totals.userMeals)}</span><span className="supplier-summary-label">پرسنل</span></div>
        <div className="supplier-summary-card"><span className="supplier-summary-val">{faDigits(totals.guestMeals)}</span><span className="supplier-summary-label">مهمان</span></div>
      </div>
      <div className="supplier-days-grid">
        {days.map((day) => {
          const foods = day.foods || [];
          if (!foods.length) {
            return (
              <div key={day.jalaliDate} className="supplier-day-card is-empty">
                <div className="supplier-day-head"><span>{day.jalaliDate}</span><span className="supplier-day-total">۰ پرس</span></div>
                <div className="supplier-day-empty">بدون سفارش</div>
              </div>
            );
          }
          const groups = foodsGroupedForPrep(foods, categories);
          let rowIndex = 0;
          return (
            <div key={day.jalaliDate} className="supplier-day-card">
              <div className="supplier-day-head">
                <span><i className="fas fa-calendar-day" /> {day.jalaliDate}</span>
                <span className="supplier-day-total">{faDigits(day.totalMeals)} پرس</span>
              </div>
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table className="report-table">
                  <thead><tr><th>#</th><th style={{ textAlign: 'right' }}>نام غذا</th><th>تعداد پرس</th></tr></thead>
                  <tbody>
                    {groups.flatMap((group) => [
                      <tr key={`cat-${group.key}`} className="supplier-cat-row">
                        <td colSpan={3}>{group.name}</td>
                      </tr>,
                      ...group.items.map((food) => {
                        rowIndex += 1;
                        return (
                          <tr key={`${group.key}-${food.foodName}`}>
                            <td>{faDigits(rowIndex)}</td>
                            <td className="col-name" style={{ textAlign: 'right', fontWeight: 700 }}>{food.foodName}</td>
                            <td className="col-total"><strong>{faDigits(food.count)}</strong></td>
                          </tr>
                        );
                      }),
                    ])}
                  </tbody>
                </table>
              </div>
              <div className="supplier-day-split">پرسنل: {faDigits(day.userMeals)} — مهمان: {faDigits(day.guestMeals)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MonthlyReport({ report }) {
  if (!report) {
    return (
      <EmptyState icon="fa-calendar-days" title="انتخاب ماه گزارش" desc="از فهرست بالا، ماه شمسی مورد نظر را انتخاب کنید تا گزارش ماهیانه نمایش داده شود." />
    );
  }

  const categories = reportCategories(report);
  const byUser = (report.byUser || [])
    .map((u) => ({
      name: u.fullName || u.username || '-',
      department: u.department || 'بدون واحد',
      count: Number(u.total || 0),
      price: Number(u.totalPrice || 0),
    }))
    .filter((u) => u.count > 0 || u.price > 0)
    .sort((a, b) => b.count - a.count || b.price - a.price);

  const guestRows = (report.byGuest || [])
    .map((guest) => ({
      code: guest.guestCode || '-',
      name: guest.fullName || '-',
      type: guest.guestTypeLabel || (guest.guestType === 'permanent' ? 'دائم' : 'موقت'),
      count: Number(guest.total || 0),
      price: Number(guest.totalPrice || 0),
    }))
    .filter((guest) => guest.count > 0 || guest.price > 0)
    .sort((a, b) => b.count - a.count || b.price - a.price);

  const foodGroups = groupItemsByCategory(report.byFood || [], (f) => f.category, categories);

  if (!byUser.length && !guestRows.length) {
    return <EmptyState icon="fa-calendar-xmark" title="سفارش تاییدشده‌ای در این ماه ثبت نشده" desc="فقط سفارش‌های تایید شده در گزارش مالی نمایش داده می‌شوند." />;
  }

  const totalCount = byUser.reduce((s, u) => s + u.count, 0);
  const totalPrice = byUser.reduce((s, u) => s + u.price, 0);
  const guestTotalCount = guestRows.reduce((s, g) => s + g.count, 0);
  const guestTotalPrice = guestRows.reduce((s, g) => s + g.price, 0);
  let foodIndex = 0;

  return (
    <>
      {byUser.length > 0 && (
        <div className="table-wrap report-table-scroll">
          <table className="report-table">
            <thead><tr><th>#</th><th className="col-name" style={{ textAlign: 'right' }}>نام فرد</th><th>واحد</th><th className="col-total">جمع وعده</th><th className="col-price">{`هزینه (${tomanLabel()})`}</th></tr></thead>
            <tbody>
              {byUser.map((u, i) => (
                <tr key={u.name + u.department}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="col-name" style={{ textAlign: 'right', fontWeight: 700 }}>{u.name}</td>
                  <td>{u.department}</td>
                  <td className="col-total">{faDigits(u.count)}</td>
                  <td className="col-price" title={money(u.price)}>{compactMoney(u.price)}</td>
                </tr>
              ))}
              <tr className="report-total-row">
                <td colSpan={3} style={{ textAlign: 'right' }}>جمع کل</td>
                <td className="col-total">{faDigits(totalCount)}</td>
                <td className="col-price" title={money(totalPrice)}>{compactMoney(totalPrice)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {foodGroups.length > 0 && (
        <div className="card mt-3">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-bowl-food" style={{ marginLeft: 8, color: 'var(--primary)' }} /> خلاصه غذاها بر اساس دسته</div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap report-table-scroll" style={{ border: 'none', borderRadius: 0, background: 'transparent' }}>
              <table className="report-table">
                <thead><tr><th>#</th><th className="col-name" style={{ textAlign: 'right' }}>نام غذا</th><th className="col-total">جمع وعده</th><th className="col-price">{`هزینه (${tomanLabel()})`}</th></tr></thead>
                <tbody>
                  {foodGroups.flatMap((group) => [
                    <tr key={`cat-${group.key}`} className="dept-group-row">
                      <td colSpan={4} style={{ background: 'var(--primary-bg)', fontWeight: 800, textAlign: 'right', padding: '10px 12px' }}>{group.name}</td>
                    </tr>,
                    ...group.items.map((food) => {
                      foodIndex += 1;
                      return (
                        <tr key={`${group.key}-${food.foodId || food.foodName}`}>
                          <td>{faDigits(foodIndex)}</td>
                          <td className="col-name" style={{ textAlign: 'right', fontWeight: 700 }}>{food.foodName}</td>
                          <td className="col-total">{faDigits(food.count)}</td>
                          <td className="col-price" title={money(food.totalPrice)}>{compactMoney(food.totalPrice)}</td>
                        </tr>
                      );
                    }),
                  ])}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {guestRows.length > 0 && (
        <div className="card mt-3">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-user-tag" style={{ marginLeft: 8, color: 'var(--primary)' }} /> گزارش ماهیانه مهمان‌ها</div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap report-table-scroll" style={{ border: 'none', borderRadius: 0, background: 'transparent' }}>
              <table className="report-table">
                <thead><tr><th>#</th><th>کد مهمان</th><th className="col-name" style={{ textAlign: 'right' }}>نام مهمان</th><th>نوع</th><th className="col-total">جمع وعده</th><th className="col-price">{`هزینه (${tomanLabel()})`}</th></tr></thead>
                <tbody>
                  {guestRows.map((guest, i) => (
                    <tr key={guest.code + guest.name}>
                      <td>{faDigits(i + 1)}</td>
                      <td><span className="guest-code-badge">{guest.code}</span></td>
                      <td className="col-name" style={{ textAlign: 'right', fontWeight: 700 }}>{guest.name}</td>
                      <td>{guest.type}</td>
                      <td className="col-total">{faDigits(guest.count)}</td>
                      <td className="col-price" title={money(guest.price)}>{compactMoney(guest.price)}</td>
                    </tr>
                  ))}
                  <tr className="report-total-row">
                    <td colSpan={4} style={{ textAlign: 'right' }}>جمع کل مهمان</td>
                    <td className="col-total">{faDigits(guestTotalCount)}</td>
                    <td className="col-price" title={money(guestTotalPrice)}>{compactMoney(guestTotalPrice)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
