import { useEffect, useState } from 'react';
import { api, apiBlob, downloadBlob } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import SectionHeader from '../shared/SectionHeader';
import AdminSpinner from '../shared/AdminSpinner';
import EmptyState from '../shared/EmptyState';
import TableActions from '../shared/TableActions';
import { faDigits, money } from '../../../utils/format';

export default function FinanceTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState({ showFinancialStatementToUsers: true, organizationSharePercent: 50 });
  const [weeks, setWeeks] = useState([]);
  const [months, setMonths] = useState([]);
  const [subTab, setSubTab] = useState('weekly');
  const [weekId, setWeekId] = useState('');
  const [monthVal, setMonthVal] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, w, m] = await Promise.all([
        api('/api/admin/finance-settings'),
        api('/api/admin/weeks?noSync=true'),
        api('/api/admin/finance-statements/months'),
      ]);
      if (s.success) setSettings(s.data);
      const wl = w.success ? w.data : [];
      setWeeks(wl);
      if (wl.length) setWeekId(wl.find((x) => x.isActive)?._id || wl[0]._id);
      const ml = m.success ? m.data : [];
      setMonths(ml);
      if (ml.length) setMonthVal(`${ml[0].from}|${ml[0].to}`);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (loading) return;
    loadStatements();
  }, [subTab, weekId, monthVal, loading]);

  async function loadStatements() {
    let url = '/api/admin/finance-statements?';
    if (subTab === 'monthly') {
      if (!monthVal) { setData(null); return; }
      const [from, to] = monthVal.split('|');
      url += `jalaliFrom=${encodeURIComponent(from)}&jalaliTo=${encodeURIComponent(to)}`;
    } else {
      url += weekId ? `weekId=${weekId}` : 'type=week';
    }
    const res = await api(url);
    setData(res.success ? res.data : null);
  }

  async function saveSettings() {
    const res = await api('/api/admin/finance-settings', {
      method: 'PUT',
      body: JSON.stringify({
        showFinancialStatementToUsers: settings.showFinancialStatementToUsers,
        organizationSharePercent: Number(settings.organizationSharePercent),
      }),
    });
    if (res.success) toast('تنظیمات ذخیره شد', 'success');
    else toast(res.message || 'خطا', 'error');
  }

  async function downloadPdf(userKey) {
    let url = '/api/admin/finance-statements/pdf?';
    if (subTab === 'monthly') {
      const [from, to] = monthVal.split('|');
      url += `jalaliFrom=${encodeURIComponent(from)}&jalaliTo=${encodeURIComponent(to)}`;
    } else {
      url += weekId ? `weekId=${weekId}` : 'type=week';
    }
    if (userKey) url += `&userKey=${encodeURIComponent(userKey)}`;
    try {
      const res = await apiBlob(url);
      downloadBlob(await res.blob(), `finance-${Date.now()}.pdf`);
    } catch { toast('خطا در PDF', 'error'); }
  }

  if (loading) return <AdminSpinner />;

  const summary = data?.summary || {};
  const split = data?.split || {};
  const users = data?.users || [];
  const org = Number(settings.organizationSharePercent || 0);
  const personal = 100 - org;
  const orgSplit = Number(split.organizationSharePercent ?? org);
  const personalSplit = Number(split.personalSharePercent ?? personal);
  const hasTotals = !!(summary.userCount || summary.mealCount);

  return (
    <section id="tab-finance" className="tab-pane active">
      <SectionHeader title="مالی و حسابداری" sub="تنظیم سهم پرداخت و صدور صورتحساب کاربران" />
      <div className="finance-layout">
        <aside className="finance-sidebar card">
          <div className="card-header"><div className="card-title"><i className="fas fa-sliders" /> تنظیمات سهم</div></div>
          <div className="card-body">
            <label className="finance-toggle">
              <input type="checkbox" id="financeShowToUsers" checked={settings.showFinancialStatementToUsers !== false} onChange={(e) => setSettings({ ...settings, showFinancialStatementToUsers: e.target.checked })} />
              <span className="finance-toggle-ui" />
              <span className="finance-toggle-text">نمایش صورتحساب در پرتال کاربران</span>
            </label>
            <div className="finance-percent-block">
              <label className="form-label" htmlFor="financeOrgPercent">سهم سازمان</label>
              <div className="finance-percent-row">
                <input className="form-control" id="financeOrgPercent" type="number" min={0} max={100} value={org} onChange={(e) => setSettings({ ...settings, organizationSharePercent: e.target.value })} />
                <span className="finance-percent-suffix" aria-hidden="true">٪</span>
              </div>
              <div className="finance-split-chips">
                <span className="finance-chip org">سازمان: <strong id="financeOrgPreview">{faDigits(org)}٪</strong></span>
                <span className="finance-chip personal">شخص: <strong id="financePersonalPreview">{faDigits(personal)}٪</strong></span>
              </div>
            </div>
            <button className="btn btn-primary btn-w100" type="button" id="financeSaveBtn" onClick={saveSettings}><i className="fas fa-save" /> ذخیره تنظیمات</button>
            <p className="finance-sidebar-note"><i className="fas fa-circle-info" aria-hidden="true" /><span>فقط سفارش‌های تاییدشده در صورتحساب لحاظ می‌شوند.</span></p>
          </div>
        </aside>
        <div className="finance-main card">
          <div className="finance-toolbar">
            <div className="finance-toolbar-title"><i className="fas fa-file-invoice-dollar" /><span>صورتحساب کاربران</span></div>
            <div className="finance-toolbar-actions report-controls">
              <div className="sub-tabs">
                <button type="button" className={`sub-tab-btn${subTab === 'weekly' ? ' active' : ''}`} id="financeSubWeekly" onClick={() => setSubTab('weekly')}><i className="fas fa-calendar-week" /> هفتگی</button>
                <button type="button" className={`sub-tab-btn${subTab === 'monthly' ? ' active' : ''}`} id="financeSubMonthly" onClick={() => setSubTab('monthly')}><i className="fas fa-calendar" /> ماهیانه</button>
              </div>
              {subTab === 'weekly' ? (
                <select className="form-control" id="financeWeekSelect" value={weekId} onChange={(e) => setWeekId(e.target.value)}>
                  {weeks.map((w) => <option key={w._id} value={w._id}>{w.jalaliStart} تا {w.jalaliEnd}</option>)}
                </select>
              ) : (
                <select className="form-control" id="financeMonthSelect" value={monthVal} onChange={(e) => setMonthVal(e.target.value)}>
                  {months.map((m) => <option key={`${m.from}|${m.to}`} value={`${m.from}|${m.to}`}>{m.label}</option>)}
                </select>
              )}
              <button type="button" className="btn btn-primary btn-sm" id="financePdfAllBtn" onClick={() => downloadPdf()}><i className="fas fa-file-pdf" /> PDF همه</button>
            </div>
          </div>
          <div className={`report-grid finance-summary-grid${hasTotals ? ' has-split-cards' : ''}`} id="financeTotalsBar">
            {hasTotals && (
              <>
                <div className="mini-card"><div className="stat-label">کاربران</div><div className="stat-value">{faDigits(summary.userCount || 0)}</div></div>
                <div className="mini-card"><div className="stat-label">مهمان</div><div className="stat-value">{faDigits(summary.guestCount || 0)}</div></div>
                <div className="mini-card"><div className="stat-label">وعده</div><div className="stat-value">{faDigits(summary.mealCount || 0)}</div></div>
                <div className="mini-card"><div className="stat-label">جمع کل</div><div className="stat-value">{faDigits(summary.grossTotal || 0)}</div></div>
                <div className="mini-card"><div className="stat-label">سهم سازمان ({faDigits(orgSplit)}٪)</div><div className="stat-value">{faDigits(summary.organizationAmount || 0)}</div></div>
                <div className="mini-card"><div className="stat-label">سهم شخص ({faDigits(personalSplit)}٪)</div><div className="stat-value">{faDigits(summary.personalAmount || 0)}</div></div>
              </>
            )}
          </div>
          <div className="table-wrap finance-table-wrap" id="financeStatementsWrap">
            {!users.length ? (
              <EmptyState icon="fa-file-invoice-dollar" title="صورتحسابی برای این بازه ثبت نشده" desc="پس از تایید سفارش‌های کاربران و مهمان‌ها، صورتحساب‌ها در این بخش نمایش داده می‌شوند." />
            ) : (
              <table className="table statement-table">
                <thead>
                  <tr>
                    <th>شماره صورتحساب</th>
                    <th>نام</th>
                    <th>نوع</th>
                    <th>واحد</th>
                    <th>وعده</th>
                    <th>مبلغ کل</th>
                    <th>پرداختی سازمان</th>
                    <th>پرداختی شخص</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isGuest = u.kind === 'guest';
                    const typeLabel = isGuest ? `مهمان ${u.guestTypeLabel || ''}`.trim() : 'پرسنل';
                    const typeClass = isGuest ? 'guest-type-chip temporary' : 'guest-status-chip active';
                    return (
                      <tr key={u.userKey}>
                        <td className="statement-number-col">{u.statementNumber || '—'}</td>
                        <td style={{ fontWeight: 800 }}>
                          {u.fullName || '-'}
                          {isGuest && u.guestCode && (
                            <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              کد: <span className="guest-code-badge">{u.guestCode}</span>
                            </div>
                          )}
                        </td>
                        <td><span className={typeClass}>{typeLabel}</span></td>
                        <td>{u.department || '-'}</td>
                        <td>{faDigits(u.mealCount || 0)}</td>
                        <td>{money(u.grossTotal)}</td>
                        <td className="statement-org-col">{money(u.organizationAmount)}</td>
                        <td className="statement-personal-col">{money(u.personalAmount)}</td>
                        <TableActions>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadPdf(u.userKey)} title="دانلود PDF"><i className="fas fa-file-pdf" /></button>
                        </TableActions>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
