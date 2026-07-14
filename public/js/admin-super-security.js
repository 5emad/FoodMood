let systemLogPagination = { page: 1, perPage: 15, total: 0, totalPages: 1 };

function securityTypeLabel(type) {
  return {
    login_success: 'ورود موفق', login_failed: 'ورود ناموفق', account_locked: 'قفل حساب',
    account_unlocked: 'آنلاک حساب', super_token_required: 'درخواست توکن',
    super_token_success: 'توکن موفق', super_token_failed: 'توکن ناموفق',
    backup_export: 'خروجی پشتیبان', backup_restore: 'بازیابی پشتیبان',
  }[type] || type;
}

async function loadSecurityCenter() {
  const badge = document.getElementById('securityNotifyBadge');
  const data = await api('/api/admin/security/summary');
  if (!data.success) { notify(data.message || 'خطا در دریافت اطلاعات امنیتی', 'error'); return; }
  const { lockedUsers = [], failedSummary = [], recentLogs = [], unreadCount = 0 } = data.data || {};
  if (badge) {
    badge.style.display = unreadCount ? 'inline-flex' : 'none';
    badge.textContent = unreadCount > 99 ? '+99' : String(unreadCount);
  }
  document.getElementById('lockedCount').textContent = lockedUsers.length.toLocaleString('fa-IR');
  document.getElementById('failedCount').textContent = failedSummary.reduce((s, i) => s + Number(i.count || 0), 0).toLocaleString('fa-IR');
  document.getElementById('securityUnreadCount').textContent = unreadCount.toLocaleString('fa-IR');

  document.getElementById('lockedUsersWrap').innerHTML = `<table class="table"><thead><tr><th>کاربر</th><th>نقش</th><th>تلاش‌ها</th><th>قفل تا</th><th>عملیات</th></tr></thead><tbody>${lockedUsers.map(u => `
    <tr><td style="font-weight:800">${esc(u.fullName || u.username)}</td><td>${esc(u.role)}</td><td>${Number(u.loginAttempts || 0).toLocaleString('fa-IR')}</td><td>${new Date(u.lockUntil).toLocaleString('fa-IR')}</td>
    <td><button class="btn btn-success btn-sm" onclick="unlockSecurityUser('${u._id}')"><i class="fas fa-unlock"></i> آنلاک</button></td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">حساب قفل‌شده‌ای وجود ندارد</td></tr>'}</tbody></table>`;

  document.getElementById('failedSummaryWrap').innerHTML = `<table class="table"><thead><tr><th>شناسه</th><th>تعداد</th><th>آخرین IP</th><th>آخرین تلاش</th></tr></thead><tbody>${failedSummary.map(item => `
    <tr><td style="direction:ltr">${esc(item._id)}</td><td><span class="badge badge-danger">${Number(item.count || 0).toLocaleString('fa-IR')}</span></td><td style="direction:ltr">${esc(item.ip || '-')}</td><td>${new Date(item.lastAt).toLocaleString('fa-IR')}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">موردی ثبت نشده</td></tr>'}</tbody></table>`;

  document.getElementById('securityLogsWrap').innerHTML = `<table class="table"><thead><tr><th>زمان</th><th>نوع</th><th>کاربر</th><th>IP</th><th>پیام</th></tr></thead><tbody>${recentLogs.map(log => `
    <tr><td style="white-space:nowrap">${new Date(log.createdAt).toLocaleString('fa-IR')}</td><td><span class="badge badge-primary">${esc(securityTypeLabel(log.type))}</span></td><td style="direction:ltr">${esc(log.username || '-')}</td><td style="direction:ltr">${esc(log.ip || '-')}</td><td>${esc(log.message || '-')}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">لاگی ثبت نشده</td></tr>'}</tbody></table>`;

  await loadSystemLogs();
}

function systemLogLevelFilterChanged() { systemLogPagination.page = 1; loadSystemLogs(); }
function systemLevelLabel(level) { return { error: 'خطا', warn: 'هشدار', info: 'اطلاع' }[level] || level; }
function systemCategoryLabel(cat) { return { database: 'پایگاه داده', server: 'سرویس', orders: 'سفارش‌ها', auth: 'احراز هویت', lifecycle: 'چرخه عمر', api: 'رابط برنامه' }[cat] || cat; }
function systemEventLabel(event) {
  return { server_start: 'راه‌اندازی سرویس', server_stop: 'توقف سرویس', db_connect: 'اتصال پایگاه داده', db_disconnect: 'قطع پایگاه داده', db_reconnect_attempt: 'تلاش اتصال مجدد', service_unavailable: 'قطعی سامانه', service_restored: 'بازیابی سامانه', http_error: 'خطای درخواست', app_error: 'خطای برنامه', unhandled_rejection: 'خطای ناهمگام', uncaught_exception: 'خطای بحرانی', order_job_error: 'خطای سفارش', port_conflict: 'تعارض پورت', bootstrap_error: 'خطای راه‌اندازی', db_test_outage: 'تست قطعی' }[event] || (event || 'رویداد سیستمی');
}
function goToSystemLogsPage(page) { loadSystemLogs(Math.min(Math.max(1, Number(page) || 1), Number(systemLogPagination.totalPages || 1))); }

async function loadSystemLogs(page) {
  const wrap = document.getElementById('systemLogsWrap');
  const pager = document.getElementById('systemLogsPagination');
  const badge = document.getElementById('systemHealthBadge');
  const testWrap = document.getElementById('systemTestWrap');
  const levelFilter = document.getElementById('systemLogLevelFilter');
  if (!wrap) return;
  if (page) systemLogPagination.page = Number(page) || 1;
  const qs = new URLSearchParams({ page: String(systemLogPagination.page), perPage: String(systemLogPagination.perPage) });
  if (levelFilter?.value) qs.set('level', levelFilter.value);
  wrap.innerHTML = '<div style="padding:32px;text-align:center"><div class="spinner"></div></div>';
  if (pager) pager.innerHTML = '';
  const data = await api(`/api/admin/system/logs?${qs.toString()}`);
  if (!data.success) { wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">خطا در دریافت لاگ‌های سیستمی</div>'; return; }
  const { logs = [], health = {}, lifecycle = {}, pagination = {}, testMode = false } = data.data || {};
  systemLogPagination = { page: Number(pagination.page || 1), perPage: Number(pagination.perPage || 15), total: Number(pagination.total || 0), totalPages: Number(pagination.totalPages || 1) };
  if (testWrap) testWrap.style.display = testMode ? 'block' : 'none';
  const setLc = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = Number(val || 0).toLocaleString('fa-IR'); };
  setLc('lcServerStarts', lifecycle.serverStarts); setLc('lcServerStops', lifecycle.serverStops); setLc('lcDbConnects', lifecycle.dbConnects); setLc('lcDbDisconnects', lifecycle.dbDisconnects);
  if (badge) { const ok = health.healthy !== false; badge.className = `badge ${ok ? 'badge-success' : 'badge-danger'}`; badge.textContent = ok ? 'سالم' : 'قطعی'; }
  wrap.innerHTML = `<table class="table"><thead><tr><th>زمان</th><th>رویداد</th><th>سطح</th><th>بخش</th><th>شرح</th><th>جزئیات فنی</th></tr></thead><tbody>${logs.map(log => `
    <tr><td style="white-space:nowrap">${log.ts ? new Date(log.ts).toLocaleString('fa-IR') : '-'}</td><td><span class="badge badge-primary">${esc(systemEventLabel(log.event))}</span></td>
    <td><span class="badge ${log.level === 'error' ? 'badge-danger' : log.level === 'warn' ? 'badge-warning' : 'badge-primary'}">${esc(systemLevelLabel(log.level))}</span></td>
    <td>${esc(systemCategoryLabel(log.category))}</td><td>${esc(log.message || '-')}</td><td style="direction:ltr;font-size:.72rem">${esc(log.detail || log.url || log.code || '-')}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">رخدادی ثبت نشده است</td></tr>'}</tbody></table>`;
  if (pager) pager.innerHTML = renderPaginationBar(systemLogPagination, 'goToSystemLogsPage') || '';
}

async function runDbOutageTest(btn) {
  if (!(await confirmAction({ title: 'تست قطعی دیتابیس؟', text: '۳۰ ثانیه دیتابیس قطع می‌شود.', confirmText: 'شروع تست', icon: 'warning' }))) return;
  btn.disabled = true;
  const data = await api('/api/system/test-disconnect-db', { method: 'POST', body: JSON.stringify({ seconds: 30 }) });
  btn.disabled = false;
  if (data.success) { notify(data.message || 'تست شروع شد'); setTimeout(() => { systemLogPagination.page = 1; loadSystemLogs(); }, 2000); }
  else notify(data.message || 'تست در دسترس نیست', 'error');
}

async function unlockSecurityUser(id) {
  if (!(await confirmAction({ title: 'آنلاک حساب؟', confirmText: 'آنلاک', icon: 'warning' }))) return;
  const data = await api(`/api/admin/security/users/${id}/unlock`, { method: 'POST' });
  if (data.success) { notify(data.message || 'حساب آنلاک شد.'); loadSecurityCenter(); }
  else notify(data.message || 'خطا در آنلاک', 'error');
}

async function resetOwnSuperToken() {
  if (!(await confirmAction({ title: 'تغییر توکن سوپر ادمین؟', confirmText: 'تغییر توکن', icon: 'warning' }))) return;
  const data = await api('/api/admin/security/super-token/reset', { method: 'POST' });
  if (data.success && data.superToken) { await showSuperToken(data.superToken); loadSecurityCenter(); }
  else notify(data.message || 'خطا در تغییر توکن', 'error');
}

loadSecurityCenter();
