import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiBlob, downloadBlob } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import SectionHeader from '../shared/SectionHeader';
import AdminSpinner from '../shared/AdminSpinner';
import { adminTabPath } from '../../../lib/adminPaths';
import { DailyStatsGrid, MonthlyReport, SupplierReportView, WeeklyPersonnelReport } from '../reports/WeeklyReportViews';

function weekSelectLabel(w) {
  const prefix = w.isActive ? 'فعال - ' : '';
  return `${prefix}${w.jalaliStart} تا ${w.jalaliEnd}`;
}

export default function ReportsTab() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [access, setAccess] = useState({ allowed: true, pendingCount: 0, message: '' });
  const [weeks, setWeeks] = useState([]);
  const [months, setMonths] = useState([]);
  const [subTab, setSubTab] = useState('weekly');
  const [weeklyTab, setWeeklyTab] = useState('personnel');
  const [personnelCellMode, setPersonnelCellMode] = useState('names');
  const [weekId, setWeekId] = useState('');
  const [monthVal, setMonthVal] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [printWeekly, setPrintWeekly] = useState('');
  const [printMonthly, setPrintMonthly] = useState('');

  useEffect(() => {
    (async () => {
      const [acc, w, m] = await Promise.all([
        api('/api/admin/reports/access'),
        api('/api/admin/weeks?noSync=true'),
        api('/api/admin/reports/months'),
      ]);
      if (acc.success) setAccess(acc.data || {});
      const weekList = w.success ? w.data : [];
      setWeeks(weekList);
      if (weekList.length) setWeekId(weekList.find((x) => x.isActive)?._id || weekList[0]._id);
      const monthList = m.success ? m.data : [];
      setMonths(monthList);
      if (monthList.length) setMonthVal(`${monthList[0].from}|${monthList[0].to}`);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!access.allowed || loading) return;
    loadReport();
  }, [subTab, weeklyTab, weekId, monthVal, access.allowed, loading]);

  async function loadReport() {
    setReportLoading(true);
    let url = '/api/admin/reports';
    if (subTab === 'monthly') {
      if (!monthVal) { setReport(null); setReportLoading(false); return; }
      const [from, to] = monthVal.split('|');
      url += `?jalaliFrom=${encodeURIComponent(from)}&jalaliTo=${encodeURIComponent(to)}`;
    } else if (weeklyTab === 'supplier') {
      url = `/api/admin/reports/supplier?${weekId ? `weekId=${weekId}` : 'type=week'}`;
    } else {
      url += `?${weekId ? `weekId=${weekId}` : 'type=week'}`;
    }
    const data = await api(url);
    const payload = data.success ? data.data : null;
    setReport(payload);
    if (payload?.range) {
      const label = `گزارش ${subTab === 'monthly' ? 'ماهیانه' : 'هفتگی'} — ${payload.range.jalaliStart} تا ${payload.range.jalaliEnd}`;
      if (subTab === 'monthly') setPrintMonthly(label);
      else setPrintWeekly(label);
    }
    setReportLoading(false);
  }

  async function downloadPdf() {
    let url = '/api/admin/reports/pdf?';
    if (subTab === 'monthly') {
      const [from, to] = monthVal.split('|');
      url += `jalaliFrom=${encodeURIComponent(from)}&jalaliTo=${encodeURIComponent(to)}`;
    } else if (weeklyTab === 'supplier') {
      url = `/api/admin/reports/supplier/pdf?${weekId ? `weekId=${weekId}` : 'type=week'}`;
    } else {
      url += weekId ? `weekId=${weekId}` : 'type=week';
      if (weeklyTab === 'personnel' && personnelCellMode === 'type1') {
        url += '&cellMode=type1';
      }
    }
    try {
      const res = await apiBlob(url);
      if (!res.ok) { toast('خطا در PDF', 'error'); return; }
      downloadBlob(await res.blob(), `report-${Date.now()}.pdf`);
      toast('PDF دانلود شد', 'success');
    } catch { toast('خطا در PDF', 'error'); }
  }

  if (loading) return <AdminSpinner />;

  return (
    <section id="tab-reports" className="tab-pane active">
      {!access.allowed && (
        <div id="reportsGateBanner" className="reports-gate-banner">
          <div className="reports-gate-icon"><i className="fas fa-lock" /></div>
          <div>
            <div className="reports-gate-title">دسترسی به گزارش‌ها قفل است</div>
            <div className="reports-gate-text" id="reportsGateText">{access.message || 'ابتدا همه سفارش‌های در انتظار تایید را در بخش سفارش‌ها تایید کنید.'}</div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => navigate(adminTabPath('orders'))}>
            <i className="fas fa-clipboard-check" /> رفتن به سفارش‌ها
          </button>
        </div>
      )}
      {access.allowed && (
        <div id="reportsContent">
          <SectionHeader
            title="گزارش‌ها"
            sub="گزارش هفتگی و ماهیانه سفارشات"
            actions={(
              <div className="report-controls" id="reportActions">
                <div className="sub-tabs">
                  <button type="button" className={`sub-tab-btn${subTab === 'weekly' ? ' active' : ''}`} data-sub="weekly" onClick={() => setSubTab('weekly')}><i className="fas fa-calendar-week" /> هفتگی</button>
                  <button type="button" className={`sub-tab-btn${subTab === 'monthly' ? ' active' : ''}`} data-sub="monthly" onClick={() => setSubTab('monthly')}><i className="fas fa-calendar" /> ماهیانه</button>
                </div>
                {subTab === 'weekly' && (
                  <select className="form-control" id="reportWeekSelect" style={{ width: 240 }} value={weekId} onChange={(e) => setWeekId(e.target.value)}>
                    {weeks.map((w) => <option key={w._id} value={w._id}>{weekSelectLabel(w)}</option>)}
                  </select>
                )}
                <button type="button" className="btn btn-primary btn-sm" id="pdfBtn" onClick={downloadPdf}>
                  <i className="fas fa-file-pdf" /> {subTab === 'weekly' && weeklyTab === 'supplier' ? 'PDF تامین‌کننده' : 'دانلود PDF'}
                </button>
              </div>
            )}
          />

          <div id="sub-weekly" className={`sub-pane${subTab === 'weekly' ? ' active' : ''}`} style={{ display: subTab === 'weekly' ? 'block' : 'none' }}>
            <div className="weekly-report-tabs no-print">
              <button type="button" className={`weekly-report-tab${weeklyTab === 'personnel' ? ' active' : ''}`} onClick={() => setWeeklyTab('personnel')}><i className="fas fa-users" /> گزارش پرسنلی</button>
              <button type="button" className={`weekly-report-tab${weeklyTab === 'supplier' ? ' active' : ''}`} onClick={() => setWeeklyTab('supplier')}><i className="fas fa-kitchen-set" /> گزارش تامین‌کننده</button>
            </div>
            {weeklyTab === 'personnel' && (
              <div className="weekly-report-tabs no-print" style={{ marginTop: 8 }}>
                <button type="button" className={`weekly-report-tab${personnelCellMode === 'names' ? ' active' : ''}`} onClick={() => setPersonnelCellMode('names')}><i className="fas fa-utensils" /> نام غذا</button>
                <button type="button" className={`weekly-report-tab${personnelCellMode === 'type1' ? ' active' : ''}`} onClick={() => setPersonnelCellMode('type1')}><i className="fas fa-check-double" /> نوع یک (بله/خیر)</button>
              </div>
            )}
            {reportLoading ? <AdminSpinner /> : (
              <>
                <div id="weeklyPersonnelPane" hidden={weeklyTab !== 'personnel'}>
                  <div className="print-title" id="printTitleWeekly">{printWeekly}</div>
                  <div id="weeklyReportWrap"><WeeklyPersonnelReport report={weeklyTab === 'personnel' ? report : null} cellMode={personnelCellMode} /></div>
                  <DailyStatsGrid report={weeklyTab === 'personnel' ? report : null} />
                </div>
                <div id="weeklySupplierPane" hidden={weeklyTab !== 'supplier'}>
                  <div className="supplier-report-head no-print">
                    <div>
                      <div className="section-title" style={{ margin: 0 }}>گزارش تامین‌کننده</div>
                      <div className="section-sub">تعداد پرس هر غذا در هر روز هفته (پرسنل + مهمان)</div>
                    </div>
                  </div>
                  <SupplierReportView report={weeklyTab === 'supplier' ? report : null} />
                </div>
              </>
            )}
          </div>

          <div id="sub-monthly" className={`sub-pane${subTab === 'monthly' ? ' active' : ''}`} style={{ display: subTab === 'monthly' ? 'block' : 'none' }}>
            <div className="print-title" id="printTitleMonthly">{printMonthly}</div>
            <div className="section-header no-print" style={{ marginTop: 0, paddingTop: 0 }}>
              <div>
                <div className="section-title">گزارش ماهیانه</div>
                <div className="section-sub">انتخاب ماه شمسی</div>
              </div>
              <div className="d-flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="form-control" id="monthSelect" style={{ width: 200 }} value={monthVal} onChange={(e) => setMonthVal(e.target.value)}>
                  <option value="">— ماه را انتخاب کنید —</option>
                  {months.map((m) => (
                    <option key={`${m.from}|${m.to}`} value={`${m.from}|${m.to}`}>
                      {m.label} ({Number(m.count || 0).toLocaleString('fa-IR')} سفارش تاییدشده)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div id="monthlyReportWrap">
              {reportLoading ? <AdminSpinner /> : <MonthlyReport report={report} />}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
