import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction, showAlert } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import Pagination from '../shared/Pagination';
import AdminSpinner from '../shared/AdminSpinner';
import { faDigits } from '../../../utils/format';

const TYPE_LABEL = {
  login_success: 'ورود موفق', login_failed: 'ورود ناموفق', account_locked: 'قفل حساب',
  account_unlocked: 'آنلاک حساب', super_token_required: 'درخواست توکن',
  super_token_success: 'توکن موفق', super_token_failed: 'توکن ناموفق',
  backup_export: 'خروجی پشتیبان', backup_restore: 'بازیابی پشتیبان',
  logs_purged: 'پاک‌سازی لاگ‌ها', waf_blocked: 'مسدودسازی WAF',
};

const SYSTEM_LEVEL = { error: 'خطا', warn: 'هشدار', info: 'اطلاع' };
const SYSTEM_CATEGORY = { database: 'پایگاه داده', server: 'سرویس', orders: 'سفارش‌ها', auth: 'احراز هویت', lifecycle: 'چرخه عمر', api: 'رابط برنامه' };
const SYSTEM_EVENT = {
  server_start: 'راه‌اندازی سرویس', server_stop: 'توقف سرویس', db_connect: 'اتصال پایگاه داده',
  db_disconnect: 'قطع پایگاه داده', db_reconnect_attempt: 'تلاش اتصال مجدد', service_unavailable: 'قطعی سامانه',
  service_restored: 'بازیابی سامانه', http_error: 'خطای درخواست', app_error: 'خطای برنامه',
  unhandled_rejection: 'خطای ناهمگام', uncaught_exception: 'خطای بحرانی', order_job_error: 'خطای سفارش',
  port_conflict: 'تعارض پورت', bootstrap_error: 'خطای راه‌اندازی', db_test_outage: 'تست قطعی',
};

export default function SuperSecurityPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [systemLogs, setSystemLogs] = useState(null);
  const [failedPage, setFailedPage] = useState(1);
  const [logsPage, setLogsPage] = useState(1);
  const [sysPage, setSysPage] = useState(1);
  const [level, setLevel] = useState('');

  const loadSummary = useCallback(async (fp = failedPage, lp = logsPage) => {
    const data = await api(`/api/admin/security/summary?failedPage=${fp}&failedLimit=15&logsPage=${lp}&logsLimit=15`);
    if (data.success) setSummary(data.data);
  }, [failedPage, logsPage]);

  const loadSystem = useCallback(async (page = sysPage) => {
    const qs = new URLSearchParams({ page: String(page), perPage: '15' });
    if (level) qs.set('level', level);
    const data = await api(`/api/admin/system/logs?${qs}`);
    if (data.success) setSystemLogs(data.data);
  }, [sysPage, level]);

  async function refresh() {
    setLoading(true);
    await Promise.all([loadSummary(), loadSystem()]);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => { loadSummary(failedPage, logsPage); }, [failedPage, logsPage, loadSummary]);
  useEffect(() => { loadSystem(sysPage); }, [sysPage, level, loadSystem]);

  async function unlockUser(id) {
    if (!(await confirmAction({ title: 'آنلاک حساب؟', confirmText: 'آنلاک', icon: 'warning' }))) return;
    const data = await api(`/api/admin/security/users/${id}/unlock`, { method: 'POST' });
    if (data.success) { toast('حساب آنلاک شد', 'success'); refresh(); }
    else toast(data.message || 'خطا', 'error');
  }

  async function purgeLogs() {
    try {
      if (!(await confirmAction({
        title: 'پاک‌سازی همه لاگ‌ها؟',
        text: 'لاگ‌های امنیتی، سیستمی و WAF برای همیشه حذف می‌شوند.',
        confirmText: 'بله، پاک کن',
        icon: 'warning',
      }))) return;

      toast('در حال پاک‌سازی…', 'info');
      let data = await api('/api/admin/security/logs/purge', {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      // یک‌بار با CSRF تازه در صورت 403
      if (!data.success && /csrf|مجاز|forbidden/i.test(String(data.message || ''))) {
        const { resetCsrf } = await import('../../../api/client');
        resetCsrf();
        data = await api('/api/admin/security/logs/purge', {
          method: 'POST',
          body: JSON.stringify({ confirm: true }),
        });
      }

      if (data.success) {
        toast(data.message || 'لاگ‌ها پاک شدند', 'success');
        setFailedPage(1);
        setLogsPage(1);
        setSysPage(1);
        setSummary(null);
        setSystemLogs(null);
        await refresh();
      } else {
        toast(data.message || 'پاک‌سازی انجام نشد', 'error');
      }
    } catch (err) {
      toast(err?.message || 'خطا در پاک‌سازی لاگ‌ها', 'error');
    }
  }

  async function resetToken() {
    if (!(await confirmAction({ title: 'تغییر توکن سوپر ادمین؟', confirmText: 'تغییر توکن', icon: 'warning' }))) return;
    const data = await api('/api/admin/security/super-token/reset', { method: 'POST' });
    if (data.success && data.superToken) await showAlert({ title: 'توکن جدید', text: data.superToken, icon: 'success' });
    else if (data.success) toast('توکن ریست شد', 'success');
    else toast(data.message || 'خطا', 'error');
    refresh();
  }

  async function runDbTest() {
    if (!(await confirmAction({ title: 'تست قطعی دیتابیس؟', text: '۳۰ ثانیه دیتابیس قطع می‌شود.', confirmText: 'شروع تست', icon: 'warning' }))) return;
    const data = await api('/api/system/test-disconnect-db', { method: 'POST', body: JSON.stringify({ seconds: 30 }) });
    if (data.success) { toast(data.message || 'تست شروع شد', 'success'); setTimeout(() => loadSystem(1), 2000); }
    else toast(data.message || 'تست در دسترس نیست', 'error');
  }

  if (loading && !summary) return <AdminSpinner />;

  const lifecycle = systemLogs?.lifecycle || {};
  const health = systemLogs?.health || {};

  return (
    <section className="super-page-section">
      <SectionHeader
        title="عملیات سریع"
        sub="توکن، پاک‌سازی لاگ و بروزرسانی وضعیت"
        actions={(
          <div className="d-flex gap-2" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-warning btn-sm" onClick={resetToken}><i className="fas fa-key" /> تغییر توکن من</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={purgeLogs}><i className="fas fa-trash-can" /> پاک‌سازی همه لاگ‌ها</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={refresh}><i className="fas fa-rotate" /> بروزرسانی</button>
          </div>
        )}
      />

      <div className="stat-grid" id="securityStats">
        <div className="stat-card">
          <div className="stat-icon red"><i className="fas fa-lock" /></div>
          <div><div className="stat-value" id="lockedCount">{faDigits(summary?.lockedUsers?.length || 0)}</div><div className="stat-label">حساب قفل‌شده</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon yellow"><i className="fas fa-triangle-exclamation" /></div>
          <div><div className="stat-value" id="failedCount">{faDigits(summary?.failedAttemptsTotal || 0)}</div><div className="stat-label">تلاش ناموفق ۲۴ ساعت</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="fas fa-bell" /></div>
          <div><div className="stat-value" id="securityUnreadCount">{faDigits(summary?.unreadCount || 0)}</div><div className="stat-label">رخداد مهم اخیر</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><i className="fas fa-shield-halved" /></div>
          <div>
            <div className="stat-value">{faDigits(summary?.waf?.blocked24h || 0)}</div>
            <div className="stat-label">مسدودسازی WAF ۲۴س</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="fas fa-shield-halved" style={{ marginLeft: 8, color: 'var(--primary)' }} /> فایروال وب (WAF)</div>
          <span className={`badge ${summary?.waf?.enabled ? 'badge-success' : 'badge-danger'}`}>
            {summary?.waf?.enabled ? `فعال · ${summary?.waf?.engine || 'firewtwall'} · استاندارد` : 'غیرفعال'}
          </span>
        </div>
        <div className="card-body">
          <p className="section-sub" style={{ marginBottom: 12 }}>
            موتور firewtwall — مسدودسازی SQLi، XSS، Path Traversal، NoSQL/LDAP، فازیگ، burst و جعل هدر؛ بدون اعتماد به X-Forwarded-For جعلی.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>قانون</th>
                  <th>متد</th>
                  <th>مسیر</th>
                  <th>IP</th>
                  <th>شدت</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.waf?.recent || []).length ? (summary.waf.recent || []).map((row, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{row.createdAt ? new Date(row.createdAt).toLocaleString('fa-IR') : '—'}</td>
                    <td><span className="badge badge-danger">{row.rule || '—'}</span></td>
                    <td style={{ direction: 'ltr' }}>{row.method || '—'}</td>
                    <td style={{ direction: 'ltr', fontSize: '.78rem' }}>{row.path || '—'}</td>
                    <td style={{ direction: 'ltr' }}>{row.ip || '—'}</td>
                    <td>{row.severity || '—'}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>مسدودسازی WAF ثبت نشده</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">کاربران قفل‌شده</div></div>
        <div className="card-body">
          <div className="table-wrap" id="lockedUsersWrap">
            <table className="table">
              <thead><tr><th>کاربر</th><th>نقش</th><th>تلاش‌ها</th><th>قفل تا</th><th>عملیات</th></tr></thead>
              <tbody>
                {(summary?.lockedUsers || []).length ? (summary.lockedUsers || []).map((u) => (
                  <tr key={u._id}>
                    <td style={{ fontWeight: 800 }}>{u.fullName || u.username}</td>
                    <td>{u.role}</td>
                    <td>{faDigits(u.loginAttempts || 0)}</td>
                    <td>{u.lockUntil ? new Date(u.lockUntil).toLocaleString('fa-IR') : '—'}</td>
                    <td><button type="button" className="btn btn-success btn-sm" onClick={() => unlockUser(u._id)}><i className="fas fa-unlock" /> آنلاک</button></td>
                  </tr>
                )) : <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>حساب قفل‌شده‌ای وجود ندارد</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">تلاش‌های ناموفق پرتکرار</div></div>
        <div className="card-body">
          <div className="table-wrap" id="failedSummaryWrap">
            <table className="table">
              <thead><tr><th>شناسه</th><th>تعداد</th><th>آخرین IP</th><th>آخرین تلاش</th></tr></thead>
              <tbody>
                {(summary?.failedSummary || []).length ? (summary.failedSummary || []).map((item) => (
                  <tr key={item._id}>
                    <td style={{ direction: 'ltr' }}>{item._id}</td>
                    <td><span className="badge badge-danger">{faDigits(item.count || 0)}</span></td>
                    <td style={{ direction: 'ltr' }}>{item.ip || '-'}</td>
                    <td>{item.lastAt ? new Date(item.lastAt).toLocaleString('fa-IR') : '—'}</td>
                  </tr>
                )) : <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>موردی ثبت نشده</td></tr>}
              </tbody>
            </table>
          </div>
          <div id="failedSummaryPagination">
            <Pagination page={summary?.failedPagination?.page || failedPage} totalPages={summary?.failedPagination?.totalPages || 1} total={summary?.failedPagination?.total} onPage={setFailedPage} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">آخرین لاگ‌های امنیتی</div></div>
        <div className="card-body">
          <div className="table-wrap" id="securityLogsWrap">
            <table className="table">
              <thead><tr><th>زمان</th><th>نوع</th><th>کاربر</th><th>IP</th><th>پیام</th></tr></thead>
              <tbody>
                {(summary?.recentLogs || []).length ? (summary.recentLogs || []).map((log, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.createdAt).toLocaleString('fa-IR')}</td>
                    <td><span className="badge badge-primary">{TYPE_LABEL[log.type] || log.type}</span></td>
                    <td style={{ direction: 'ltr' }}>{log.username || '-'}</td>
                    <td style={{ direction: 'ltr' }}>{log.ip || '-'}</td>
                    <td>{log.message || '-'}</td>
                  </tr>
                )) : <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>لاگی ثبت نشده</td></tr>}
              </tbody>
            </table>
          </div>
          <div id="securityLogsPagination">
            <Pagination page={summary?.logsPagination?.page || logsPage} totalPages={summary?.logsPagination?.totalPages || 1} total={summary?.logsPagination?.total} onPage={setLogsPage} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="fas fa-server" style={{ marginLeft: 8, color: 'var(--primary)' }} /> لاگ‌های سیستمی</div>
          <span id="systemHealthBadge" className={`badge ${health.healthy !== false ? 'badge-success' : 'badge-danger'}`}>{health.healthy !== false ? 'سالم' : 'قطعی'}</span>
        </div>
        <div className="card-body">
          <p className="section-sub" style={{ marginBottom: 12 }}>استارت/استاپ سرور، قطع و وصل دیتابیس — فقط سوپر ادمین. کاربران عادی صفحه «در دسترس نیست» می‌بینند.</p>
          <div className="stat-grid" id="lifecycleStats" style={{ marginBottom: 16 }}>
            <div className="stat-card"><div className="stat-icon green"><i className="fas fa-play" /></div><div><div className="stat-value" id="lcServerStarts">{faDigits(lifecycle.serverStarts)}</div><div className="stat-label">استارت سرور</div></div></div>
            <div className="stat-card"><div className="stat-icon yellow"><i className="fas fa-stop" /></div><div><div className="stat-value" id="lcServerStops">{faDigits(lifecycle.serverStops)}</div><div className="stat-label">استاپ سرور</div></div></div>
            <div className="stat-card"><div className="stat-icon blue"><i className="fas fa-database" /></div><div><div className="stat-value" id="lcDbConnects">{faDigits(lifecycle.dbConnects)}</div><div className="stat-label">اتصال دیتابیس</div></div></div>
            <div className="stat-card"><div className="stat-icon red"><i className="fas fa-plug-circle-xmark" /></div><div><div className="stat-value" id="lcDbDisconnects">{faDigits(lifecycle.dbDisconnects)}</div><div className="stat-label">قطع دیتابیس</div></div></div>
          </div>
          {systemLogs?.testMode && (
            <div id="systemTestWrap" style={{ marginBottom: 14 }}>
              <button type="button" className="btn btn-warning btn-sm" onClick={runDbTest}><i className="fas fa-vial" /> تست قطعی دیتابیس (۳۰ ثانیه)</button>
              <span className="text-muted" style={{ fontSize: '.8rem', marginRight: 10 }}>فقط حالت تست — صفحه «در دسترس نیست» را در تب ناشناس بررسی کنید</span>
            </div>
          )}
          <div className="d-flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <select className="form-control" id="systemLogLevelFilter" style={{ width: 160 }} value={level} onChange={(e) => { setLevel(e.target.value); setSysPage(1); }}>
              <option value="">همه سطوح</option>
              <option value="error">فقط خطا</option>
              <option value="warn">فقط هشدار</option>
              <option value="info">فقط اطلاع</option>
            </select>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => loadSystem(sysPage)}><i className="fas fa-rotate" /> بروزرسانی</button>
          </div>
          <div className="table-wrap" id="systemLogsWrap">
            <table className="table">
              <thead><tr><th>زمان</th><th>رویداد</th><th>سطح</th><th>بخش</th><th>شرح</th><th>جزئیات فنی</th></tr></thead>
              <tbody>
                {(systemLogs?.logs || []).length ? (systemLogs.logs || []).map((log, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{log.ts ? new Date(log.ts).toLocaleString('fa-IR') : '-'}</td>
                    <td><span className="badge badge-primary">{SYSTEM_EVENT[log.event] || log.event || 'رویداد سیستمی'}</span></td>
                    <td><span className={`badge badge-${log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warning' : 'primary'}`}>{SYSTEM_LEVEL[log.level] || log.level}</span></td>
                    <td>{SYSTEM_CATEGORY[log.category] || log.category}</td>
                    <td>{log.message || '-'}</td>
                    <td style={{ direction: 'ltr', fontSize: '.72rem' }}>{log.detail || log.url || log.code || '-'}</td>
                  </tr>
                )) : <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>رخدادی ثبت نشده است</td></tr>}
              </tbody>
            </table>
          </div>
          <div id="systemLogsPagination">
            <Pagination page={systemLogs?.pagination?.page || sysPage} totalPages={systemLogs?.pagination?.totalPages || 1} total={systemLogs?.pagination?.total} onPage={setSysPage} />
          </div>
        </div>
      </div>
    </section>
  );
}
