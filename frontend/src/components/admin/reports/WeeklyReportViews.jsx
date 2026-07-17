import { Fragment } from 'react';
import { compactMoney, faDigits, money } from '../../../utils/format';
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

function isSuperadminUser(u) {
  return String(u?.role || '').toLowerCase() === 'superadmin'
    || String(u?.username || '').toLowerCase() === 'superadmin'
    || String(u?.fullName || '').toLowerCase() === 'superadmin';
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
                <th className="col-price">هزینه (تومان)</th>
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
                        {day.foods.map((food, i) => <div key={i} className="report-food-item">{food}</div>)}
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
  const byUser = (report.byUser || []).filter((u) => !isSuperadminUser(u));
  const reportDays = report.days || byUser[0]?.days || [];
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
        <div className="table-wrap report-table-scroll">
          <table className="report-table report-table-wide">
            <thead>
              <tr>
                <th className="col-name" style={{ textAlign: 'right' }}>نام فرد</th>
                <th>واحد</th>
                {reportDays.map((d) => <th key={d.jalaliDate}>{d.jalaliDate}</th>)}
                <th className="col-total">جمع وعده</th>
                <th className="col-price">هزینه (تومان)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([dept, users]) => (
                <Fragment key={dept}>
                  <tr className="dept-group-row">
                    <td colSpan={reportDays.length + 4} style={{ background: 'var(--primary-bg)', fontWeight: 800, textAlign: 'right', padding: '10px 12px' }}>
                      {dept} <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '.82rem' }}>({faDigits(users.length)} نفر)</span>
                    </td>
                  </tr>
                  {users.slice().sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'fa')).map((u) => (
                    <tr key={u.fullName + u.department}>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{u.fullName}</td>
                      <td>{u.department}</td>
                      {reportDays.map((reportDay) => {
                        const day = (u.days || []).find((d) => d.jalaliDate === reportDay.jalaliDate);
                        if (!day?.foods?.length) return <td key={reportDay.jalaliDate} className="report-day-cell">-</td>;
                        return (
                          <td key={reportDay.jalaliDate} className="report-day-cell">
                            {day.foods.map((food, i) => <div key={i} className="report-food-item">{food}</div>)}
                          </td>
                        );
                      })}
                      <td className="col-total"><strong>{faDigits(u.total)}</strong></td>
                      <td className="col-price" title={money(u.totalPrice)}>{compactMoney(u.totalPrice)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state"><p>برای این بازه سفارشی ثبت نشده است.</p></div>
      )}
      <MissingUsersTable report={report} />
      <GuestWeeklyReport report={report} />
    </>
  );
}

export function DailyStatsGrid({ report }) {
  const days = report?.byDayPrep || [];
  if (!days.some((d) => (d.foods || []).length)) return <div className="daily-stats-grid" id="dailyStatsGrid" />;
  return (
    <div className="daily-stats-grid" id="dailyStatsGrid">
      {days.map((day) => (
        <div key={day.jalaliDate} className={`dsc${(day.foods || []).length ? '' : ' is-empty'}`}>
          <div className="dsc-head">{day.jalaliDate}</div>
          <div className="dsc-body">
            {(day.foods || []).length
              ? (day.foods || []).map((food, i) => (
                <div key={i} className="dsc-row">
                  <span className="dsc-food-name" title={food.foodName}>{food.foodName}</span>
                  <strong className="dsc-food-count">{faDigits(food.count)}</strong>
                </div>
              ))
              : <div className="dsc-empty">بدون سفارش</div>}
          </div>
          <div className="dsc-total">جمع: {faDigits(day.totalMeals)} پرس</div>
          <div className="dsc-split">پرسنل: {faDigits(day.userMeals)} — مهمان: {faDigits(day.guestMeals)}</div>
        </div>
      ))}
    </div>
  );
}

export function SupplierReportView({ report }) {
  const days = report?.byDayPrep || [];
  const totals = report?.prepTotals || { totalMeals: 0, userMeals: 0, guestMeals: 0 };
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
                    {foods.map((food, index) => (
                      <tr key={food.foodName}>
                        <td>{faDigits(index + 1)}</td>
                        <td className="col-name" style={{ textAlign: 'right', fontWeight: 700 }}>{food.foodName}</td>
                        <td className="col-total"><strong>{faDigits(food.count)}</strong></td>
                      </tr>
                    ))}
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

  const byUser = (report.byUser || [])
    .filter((u) => !isSuperadminUser(u))
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

  if (!byUser.length && !guestRows.length) {
    return <EmptyState icon="fa-calendar-xmark" title="سفارش تاییدشده‌ای در این ماه ثبت نشده" desc="فقط سفارش‌های تایید شده در گزارش مالی نمایش داده می‌شوند." />;
  }

  const totalCount = byUser.reduce((s, u) => s + u.count, 0);
  const totalPrice = byUser.reduce((s, u) => s + u.price, 0);
  const guestTotalCount = guestRows.reduce((s, g) => s + g.count, 0);
  const guestTotalPrice = guestRows.reduce((s, g) => s + g.price, 0);

  return (
    <>
      {byUser.length > 0 && (
        <div className="table-wrap report-table-scroll">
          <table className="report-table">
            <thead><tr><th>#</th><th className="col-name" style={{ textAlign: 'right' }}>نام فرد</th><th>واحد</th><th className="col-total">جمع وعده</th><th className="col-price">هزینه (تومان)</th></tr></thead>
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
      {guestRows.length > 0 && (
        <div className="card mt-3">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-user-tag" style={{ marginLeft: 8, color: 'var(--primary)' }} /> گزارش ماهیانه مهمان‌ها</div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap report-table-scroll" style={{ border: 'none', borderRadius: 0, background: 'transparent' }}>
              <table className="report-table">
                <thead><tr><th>#</th><th>کد مهمان</th><th className="col-name" style={{ textAlign: 'right' }}>نام مهمان</th><th>نوع</th><th className="col-total">جمع وعده</th><th className="col-price">هزینه (تومان)</th></tr></thead>
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
