import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';
import AppVersionBadge from '../components/AppVersionBadge';
import CategoryWeekMenuSlider from '../components/CategoryWeekMenuSlider';
import PortalProfilePanel from '../components/PortalProfilePanel';
import Pagination from '../components/admin/shared/Pagination';
import { normalizeUserCapabilities } from '../lib/portalCapabilities';
import { faDigits, jdate, money } from '../utils/format';

const STATUS_LABEL = { pending: 'در انتظار تایید', confirmed: 'تایید شده', ready: 'آماده', completed: 'تحویل شده', cancelled: 'لغو شده' };
const STATUS_CLASS = { pending: 'warning', confirmed: 'primary', ready: 'success', completed: 'success', cancelled: 'danger' };

function isAdminRole(role) {
  return role === 'admin' || role === 'superadmin';
}

function initialsFromName(name, username) {
  const raw = String(name || username || '').trim();
  if (!raw) return '؟';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`;
  return raw.slice(0, 2);
}

function getBootstrapData() {
  try {
    const el = document.getElementById('app-bootstrap-data');
    if (!el) return {};
    return JSON.parse(el.textContent || '{}');
  } catch {
    return {};
  }
}
const bootstrapData = getBootstrapData();

export default function UserDashboardPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState('menu');
  const [user, setUser] = useState(null);
  const [version, setVersion] = useState(null);
  const [caps, setCaps] = useState(normalizeUserCapabilities(bootstrapData.capabilities || {}));
  const [menu, setMenu] = useState(null);
  const [activeWeeks, setActiveWeeks] = useState([]);
  const [selectedWeekId, setSelectedWeekId] = useState('');
  const [orders, setOrders] = useState([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPagination, setOrdersPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [menuOrders, setMenuOrders] = useState([]);
  const [statements, setStatements] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingItems, setPendingItems] = useState(new Set());
  const [stmtSub, setStmtSub] = useState('weekly');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    document.body.className = 'user-portal-body';
    bootstrap();
    return () => {
      document.body.classList.remove('user-portal-body');
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('ann-drawer-open', drawerOpen || !!receipt || profileOpen);
    return () => document.body.classList.remove('ann-drawer-open');
  }, [drawerOpen, receipt, profileOpen]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    function onDocClick(e) {
      if (!e.target.closest?.('.portal-user-menu')) setUserMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen]);

  function openProfile() {
    setUserMenuOpen(false);
    setProfileOpen(true);
  }

  function goTab(next) {
    setUserMenuOpen(false);
    setProfileOpen(false);
    setTab(next);
  }

  async function bootstrap() {
    setLoading(true);
    try {
      const [boot, me, ann, pub, cats] = await Promise.all([
        api('/api/app/user/bootstrap'),
        api('/api/auth/me'),
        api('/api/announcements/active'),
        api('/api/app/public'),
        api('/api/foods/categories'),
      ]);
      if (boot.success) {
        setCaps(normalizeUserCapabilities({ ...boot.data.portalSettings, ...boot.data.capabilities }));
      }
      if (me.success) setUser(me.user);
      if (pub.success) setVersion(pub.data);
      if (ann.success) setAnnouncements((ann.data || []).filter((a) => a.title && a.body));
      if (cats.success) setCategories(cats.data || []);
      await loadMenu();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'orders') loadOrdersPage(1);
  }, [tab]);

  useEffect(() => {
    if (tab === 'statement' && caps.showStatement) {
      refreshStatementConfig().then(loadStatements);
    }
  }, [tab, stmtSub, caps.showStatement]);

  async function loadMenu(weekId = selectedWeekId) {
    const [weeksRes, lockOrdersRes] = await Promise.all([
      api('/api/menu/active-weeks'),
      api('/api/orders'),
    ]);
    const weeks = weeksRes.success ? (weeksRes.data || []) : [];
    setActiveWeeks(weeks);
    setMenuOrders(lockOrdersRes.success ? (lockOrdersRes.data || []) : []);

    let targetId = weekId ? String(weekId) : '';
    if (!targetId || (weeks.length && !weeks.some((w) => String(w._id) === targetId))) {
      targetId = weeks[0] ? String(weeks[0]._id) : '';
    }
    if (targetId) setSelectedWeekId(targetId);

    const menuRes = targetId
      ? await api(`/api/menu/weeks/${encodeURIComponent(targetId)}`)
      : await api('/api/menu/active');

    if (!menuRes.success) {
      setMenu(null);
      return;
    }
    setMenu(menuRes.data);
    if (!targetId && menuRes.data?.week?._id) {
      setSelectedWeekId(String(menuRes.data.week._id));
    }
    applyMenuCaps(menuRes.data);
  }

  function applyMenuCaps(menuData) {
    const settings = menuData?.settings || {};
    setCaps((c) => normalizeUserCapabilities({
      ...c,
      showPrices: settings.showPricesToUsers,
      showPricesToUsers: settings.showPricesToUsers,
      showStatement: settings.showFinancialStatementToUsers,
      showFinancialStatementToUsers: settings.showFinancialStatementToUsers,
    }));
  }

  async function loadOrdersPage(page = 1) {
    const res = await api(`/api/orders?page=${page}&limit=10`);
    if (res.success) {
      setOrders(Array.isArray(res.data) ? res.data : []);
      setOrdersPagination(res.pagination || { page, totalPages: 1, total: (res.data || []).length });
      setOrdersPage(Number(res.pagination?.page || page));
    } else {
      setOrders([]);
      setOrdersPagination({ page: 1, totalPages: 1, total: 0 });
    }
  }

  async function selectWeek(weekId) {
    setSelectedWeekId(String(weekId));
    const menuRes = await api(`/api/menu/weeks/${encodeURIComponent(weekId)}`);
    if (!menuRes.success) {
      toast(menuRes.message || 'بارگذاری منوی هفته ناموفق بود', 'error');
      return;
    }
    setMenu(menuRes.data);
    applyMenuCaps(menuRes.data);
  }

  async function refreshStatementConfig() {
    const data = await api('/api/user/statement/config');
    if (!data.success) return;
    setCaps((c) => normalizeUserCapabilities({
      ...c,
      showStatement: data.data.showFinancialStatementToUsers,
      showFinancialStatementToUsers: data.data.showFinancialStatementToUsers,
      organizationSharePercent: data.data.organizationSharePercent,
      personalSharePercent: data.data.personalSharePercent,
      statementDisabledMessage: data.data.statementDisabledMessage,
    }));
  }

  async function loadStatements() {
    const type = stmtSub === 'monthly' ? 'month' : 'week';
    const data = await api(`/api/user/statement/list?type=${type}`);
    if (data.success) setStatements(data.data || []);
    else setStatements([]);
  }

  async function placeOrder(menuItemId) {
    if (pendingItems.has(menuItemId)) return;
    setPendingItems((s) => new Set(s).add(menuItemId));
    try {
      const data = await api('/api/orders', { method: 'POST', body: JSON.stringify({ menuItemId }) });
      if (!data.success) return toast(data.message || 'ثبت سفارش ناموفق بود', 'error');
      toast(data.message || 'رزرو شما با موفقیت ثبت شد', 'success');
      await loadMenu(selectedWeekId);
      if (tab === 'orders') await loadOrdersPage(ordersPage);
    } catch {
      toast('خطا در اتصال', 'error');
    } finally {
      setPendingItems((s) => { const n = new Set(s); n.delete(menuItemId); return n; });
    }
  }

  async function cancelOrder(orderId) {
    const data = await api(`/api/orders/${orderId}/cancel`, { method: 'POST' });
    if (!data.success) return toast(data.message || 'لغو ناموفق بود', 'error');
    toast('سفارش لغو شد', 'success');
    await loadMenu(selectedWeekId);
    if (tab === 'orders') await loadOrdersPage(ordersPage);
  }

  async function openReceipt(row) {
    setReceiptLoading(true);
    setReceipt({ preview: row, detail: null });
    try {
      let url = '/api/user/statement?';
      if (row.periodType === 'week' || stmtSub === 'weekly') {
        url += `weekId=${encodeURIComponent(row.periodKey)}`;
      } else {
        url += `jalaliFrom=${encodeURIComponent(row.range?.jalaliStart || '')}&jalaliTo=${encodeURIComponent(row.range?.jalaliEnd || '')}&type=month`;
      }
      const data = await api(url);
      if (!data.success) {
        toast(data.message || 'دریافت جزئیات صورتحساب ناموفق بود', 'error');
        setReceipt(null);
        return;
      }
      setReceipt({ preview: row, detail: data.data });
    } catch {
      toast('خطا در اتصال', 'error');
      setReceipt(null);
    } finally {
      setReceiptLoading(false);
    }
  }

  function closeReceipt() {
    setReceipt(null);
    setReceiptLoading(false);
  }

  const orderedDayCategories = new Set();
  const orderByItem = {};
  menuOrders.filter((o) => o.status !== 'cancelled').forEach((o) => {
    const dayId = String(o.dailyMenuId?._id || o.dailyMenuId || o.menuItemId?.dailyMenuId?._id || '');
    const menuItemId = String(o.menuItemId?._id || o.menuItemId || '');
    const cat = String(
      o.foodCategory
      || o.menuItemId?.foodId?.category
      || o.items?.[0]?.foodId?.category
      || 'uncategorized',
    ).trim().toLowerCase() || 'uncategorized';
    if (dayId) orderedDayCategories.add(`${dayId}|${cat}`);
    if (menuItemId) orderByItem[menuItemId] = o;
  });

  const showAdminLink = isAdminRole(user?.role);
  const receiptData = receipt?.detail;
  const orgName = version?.organizationName || 'سامانه تغذیه';
  const week = menu?.week || menu?.weekId || {};
  const weekLabel = week.name
    || (week.startDate && week.endDate
      ? `${jdate(week.startDate)} تا ${jdate(week.endDate)}`
      : 'برنامه غذایی');

  return (
    <>
      <main className="user-portal-shell user-portal-shell--split user-portal-shell--claude">
        <aside className="user-side-nav" aria-label="منوی پرتال کارکنان">
          <div className="user-side-nav-brand">
            <div className="user-side-nav-logo" aria-hidden="true">
              <i className="fas fa-utensils" />
            </div>
            <div>
              <span className="user-side-nav-head">{orgName}</span>
              <span className="user-side-nav-sub">پرتال کارکنان</span>
            </div>
          </div>

          <nav className="user-tabs user-tabs--vertical" role="tablist" aria-label="بخش‌های پرتال">
            <button type="button" role="tab" aria-selected={tab === 'menu'} className={`tab-button${tab === 'menu' ? ' active' : ''}`} onClick={() => goTab('menu')}>
              <span className="tab-button-ico"><i className="fas fa-utensils" /></span>
              <span className="tab-button-copy">
                <span className="tab-button-label">رزرو غذا</span>
                <span className="tab-button-hint">برنامه غذایی</span>
              </span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'orders'} className={`tab-button${tab === 'orders' ? ' active' : ''}`} onClick={() => goTab('orders')}>
              <span className="tab-button-ico"><i className="fas fa-clipboard-list" /></span>
              <span className="tab-button-copy">
                <span className="tab-button-label">سفارش‌های من</span>
                <span className="tab-button-hint">پیگیری رزروها</span>
              </span>
            </button>
            {caps.showStatement && (
              <button type="button" role="tab" aria-selected={tab === 'statement'} className={`tab-button${tab === 'statement' ? ' active' : ''}`} onClick={() => goTab('statement')}>
                <span className="tab-button-ico"><i className="fas fa-file-invoice" /></span>
                <span className="tab-button-copy">
                  <span className="tab-button-label">صورتحساب</span>
                  <span className="tab-button-hint">هفتگی و ماهیانه</span>
                </span>
              </button>
            )}
          </nav>

          <div className="user-side-nav-foot user-side-nav-foot--minimal">
            <AppVersionBadge version={version} />
          </div>
        </aside>

        <div className="user-portal-main">
          <header className="portal-topbar">
            <div className={`portal-user-menu${userMenuOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="portal-user-menu-trigger"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((v) => !v)}
              >
                <span className="portal-user-menu-avatar" aria-hidden="true">
                  {initialsFromName(user?.fullName, user?.username)}
                </span>
                <span className="portal-user-menu-trigger-meta">
                  <span className="portal-user-menu-trigger-name">{user?.fullName || user?.username || 'همکار گرامی'}</span>
                  <span className="portal-user-menu-trigger-dept">{user?.department?.name || 'واحد عمومی'}</span>
                </span>
                <i className={`fas fa-chevron-down portal-user-menu-caret${userMenuOpen ? ' is-open' : ''}`} aria-hidden="true" />
              </button>

              {userMenuOpen && (
                <div className="portal-user-menu-panel" role="menu" aria-label="منوی حساب کاربری">
                  <div className="portal-user-menu-head">
                    <span className="portal-user-menu-avatar portal-user-menu-avatar--lg" aria-hidden="true">
                      {initialsFromName(user?.fullName, user?.username)}
                    </span>
                    <div className="portal-user-menu-head-copy">
                      <strong>{user?.fullName || user?.username || 'همکار گرامی'}</strong>
                      <span>{user?.department?.name || 'واحد عمومی'}</span>
                      {user?.username ? <em>@{user.username}</em> : null}
                    </div>
                  </div>
                  <div className="portal-user-menu-divider" />
                  <button type="button" role="menuitem" className="portal-user-menu-item" onClick={openProfile}>
                    <i className="fas fa-user-gear" />
                    <span>تنظیمات حساب</span>
                  </button>
                  {showAdminLink && (
                    <Link to="/admin/reports" role="menuitem" className="portal-user-menu-item" onClick={() => setUserMenuOpen(false)}>
                      <i className="fas fa-cogs" />
                      <span>پنل مدیریت</span>
                    </Link>
                  )}
                  <a href="/logout" role="menuitem" className="portal-user-menu-item portal-user-menu-item--danger">
                    <i className="fas fa-power-off" />
                    <span>خروج</span>
                  </a>
                </div>
              )}
            </div>
          </header>

          {loading && <div className="portal-loading"><div className="spinner" /></div>}

          {!loading && tab === 'menu' && (
            <section className="tab-panel active portal-menu-stage">
              <header className="portal-stage-header">
                <div>
                  <h1 className="portal-stage-title">{weekLabel}</h1>
                  <p className="portal-stage-lead">روز را انتخاب کنید، غذای هر دسته را ببینید و رزرو کنید.</p>
                </div>
              </header>
              {activeWeeks.length > 1 && (
                <div className="sub-tabs" style={{ marginBottom: 16 }} role="tablist" aria-label="هفته‌های فعال">
                  {activeWeeks.map((w) => (
                    <button
                      key={w._id}
                      type="button"
                      className={`sub-tab-btn${String(selectedWeekId) === String(w._id) ? ' active' : ''}`}
                      onClick={() => selectWeek(w._id)}
                    >
                      {w.jalaliStart} تا {w.jalaliEnd}
                    </button>
                  ))}
                </div>
              )}
              <CategoryWeekMenuSlider
                menu={menu}
                categories={categories}
                showPrices={!!caps.showPrices}
                orderedDayCategories={orderedDayCategories}
                orderByItem={orderByItem}
                pendingItems={pendingItems}
                onPlaceOrder={placeOrder}
                onCancelOrder={cancelOrder}
              />
            </section>
          )}

          {!loading && tab === 'orders' && (
            <section className="tab-panel active">
              <header className="portal-stage-header portal-stage-header--compact">
                <h1 className="portal-stage-title">سفارش‌های من</h1>
              </header>
              <div className="table-wrap">
                {!orders.length ? <div className="orders-empty"><i className="fas fa-receipt" /><p>هنوز سفارشی ثبت نکرده‌اید.</p></div> : (
                  <>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>کد</th>
                          <th>غذا</th>
                          {caps.showPrices && <th>مبلغ</th>}
                          <th>تاریخ ثبت</th>
                          <th>تاریخ تحویل</th>
                          <th>وضعیت</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o._id}>
                            <td>#{o.orderNumber || '-'}</td>
                            <td>{o.menuItemId?.foodId?.name || o.foodId?.name || '-'}</td>
                            {caps.showPrices && <td>{money(o.totalPrice)}</td>}
                            <td>{jdate(o.orderDate)}</td>
                            <td>{o.deliveryDate ? jdate(o.deliveryDate) : '—'}</td>
                            <td><span className={`badge badge-${STATUS_CLASS[o.status] || 'gray'}`}>{STATUS_LABEL[o.status] || o.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pagination
                      page={ordersPagination.page}
                      totalPages={ordersPagination.totalPages}
                      total={ordersPagination.total}
                      onPage={(p) => loadOrdersPage(p)}
                    />
                  </>
                )}
              </div>
            </section>
          )}

          {!loading && tab === 'statement' && caps.showStatement && (
            <section className="tab-panel active">
              <header className="portal-stage-header portal-stage-header--compact">
                <h1 className="portal-stage-title">صورتحساب</h1>
              </header>
              <div className="sub-tabs" style={{ marginBottom: 16 }}>
                <button type="button" className={`sub-tab-btn${stmtSub === 'weekly' ? ' active' : ''}`} onClick={() => setStmtSub('weekly')}>هفتگی</button>
                <button type="button" className={`sub-tab-btn${stmtSub === 'monthly' ? ' active' : ''}`} onClick={() => setStmtSub('monthly')}>ماهیانه</button>
              </div>
              <div className="statement-split-banner">
                سهم سازمان: <strong>{faDigits(caps.organizationSharePercent)}٪</strong>
                {' — '}
                سهم شخص: <strong>{faDigits(caps.personalSharePercent)}٪</strong>
                <span className="statement-range">فقط سفارش‌های تاییدشده در صورتحساب لحاظ می‌شوند</span>
              </div>
              <div className="table-wrap">
                {!statements.length ? <div className="orders-empty"><p>صورتحسابی ثبت نشده است.</p></div> : (
                  <table className="table statement-table">
                    <thead>
                      <tr>
                        <th>شناسه</th>
                        <th>بازه</th>
                        <th>قیمت صورتحساب</th>
                        <th>عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statements.map((s) => (
                        <tr key={s._id || s.statementNumber}>
                          <td className="statement-number-col">{s.statementNumber || '—'}</td>
                          <td>
                            {`${s.range?.jalaliStart || ''} تا ${s.range?.jalaliEnd || ''}`}
                            {s.isActive && <span className="badge badge-success" style={{ marginRight: 6 }}>جاری</span>}
                          </td>
                          <td className="statement-personal-col">
                            {money(s.summary?.personalAmount)}
                            {s.hasDiscount ? (
                              <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
                                تخفیف
                                {Number(s.discountPercent) > 0 ? ` ${faDigits(s.discountPercent)}٪` : ''}
                                {' '}(−{money(s.discountAmount || s.summary?.discountAmount || 0)})
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => openReceipt(s)}>
                              <i className="fas fa-receipt" /> نمایش بیشتر
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          <PortalProfilePanel
            open={profileOpen}
            user={user}
            onClose={() => setProfileOpen(false)}
            onUserUpdate={(next) => setUser((prev) => ({ ...prev, ...next }))}
          />
        </div>
      </main>

      {announcements.length > 0 && (
        <div className="announcements-ui">
          <button type="button" className="ann-fab" onClick={() => setDrawerOpen(true)} aria-label="اطلاعیه‌ها">
            <i className="fas fa-bullhorn" />
            <span className="ann-fab-count">{faDigits(announcements.length)}</span>
          </button>
          {drawerOpen && (
            <>
              <div className="ann-drawer-overlay" onClick={() => setDrawerOpen(false)} />
              <div className="ann-drawer is-open" role="dialog" aria-modal="true" aria-label="اطلاعیه‌های فعال">
                <div className="ann-drawer-handle" aria-hidden="true" />
                <div className="ann-drawer-header">
                  <div className="ann-drawer-title"><i className="fas fa-bullhorn" /> اطلاعیه‌های فعال</div>
                  <button type="button" className="btn-icon ann-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="بستن">
                    <i className="fas fa-times" />
                  </button>
                </div>
                <div className="ann-drawer-body">
                  {announcements.map((a) => (
                    <article key={a._id} className="announcement-card">
                      <div className="announcement-card-title">{a.title}</div>
                      <div className="announcement-card-body">{a.body}</div>
                    </article>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {(receipt || receiptLoading) && (
        <div className="receipt-modal-root">
          <div className="receipt-modal-overlay" onClick={closeReceipt} />
          <div className={`receipt-modal${stmtSub === 'monthly' ? ' receipt-modal--compact' : ''}`} role="dialog" aria-modal="true" aria-label="فیش صورتحساب">
            <button type="button" className="receipt-modal-close" onClick={closeReceipt} aria-label="بستن">
              <i className="fas fa-times" />
            </button>
            {receiptLoading && !receiptData ? (
              <div className="receipt-loading"><div className="spinner" /><p>در حال آماده‌سازی فیش...</p></div>
            ) : (
              <div className="receipt-paper">
                <div className="receipt-paper-head">
                  <div className="receipt-brand">{orgName}</div>
                  <div className="receipt-kind">فیش صورتحساب {stmtSub === 'monthly' ? 'ماهیانه' : 'هفتگی'}</div>
                </div>
                <div className="receipt-dash" />
                <div className="receipt-meta">
                  <div className="receipt-meta-row">
                    <span>شناسه</span>
                    <strong className="receipt-id">{receipt?.preview?.statementNumber || receiptData?.statementNumber || '—'}</strong>
                  </div>
                  <div className="receipt-meta-row">
                    <span>تاریخ بازه</span>
                    <strong>
                      {(receiptData?.range?.jalaliStart || receipt?.preview?.range?.jalaliStart || '—')}
                      {' تا '}
                      {(receiptData?.range?.jalaliEnd || receipt?.preview?.range?.jalaliEnd || '—')}
                    </strong>
                  </div>
                  <div className="receipt-meta-row">
                    <span>نام</span>
                    <strong>{user?.fullName || user?.username || '—'}</strong>
                  </div>
                </div>
                <div className="receipt-dash" />
                {stmtSub !== 'monthly' && (
                  <>
                    <div className="receipt-items-head">
                      <span>اقلام</span>
                      <span>مبلغ</span>
                    </div>
                    <div className="receipt-items">
                      {(receiptData?.items || []).length ? receiptData.items.map((item) => (
                        <div key={item.orderId || `${item.jalaliDate}-${item.foodName}`} className="receipt-item">
                          <div className="receipt-item-info">
                            <div className="receipt-item-name">{item.foodName}</div>
                            <div className="receipt-item-meta-row">
                              <span className="receipt-date-box">{item.jalaliDate || '—'}</span>
                              {item.orderNumber ? <span className="receipt-order-box">#{item.orderNumber}</span> : null}
                              {item.mealCount > 1 ? <span className="receipt-date-box">{faDigits(item.mealCount)} وعده</span> : null}
                            </div>
                          </div>
                          <div className="receipt-item-price">{money(item.personalAmount ?? item.grossTotal)}</div>
                        </div>
                      )) : (
                        <div className="receipt-empty">جزئیات غذایی ثبت نشده است.</div>
                      )}
                    </div>
                    <div className="receipt-dash" />
                  </>
                )}
                <div className="receipt-totals">
                  <div className="receipt-total-row">
                    <span>تعداد غذا / وعده</span>
                    <strong>{faDigits(receiptData?.summary?.mealCount || receipt?.preview?.summary?.mealCount || 0)}</strong>
                  </div>
                  <div className="receipt-total-row">
                    <span>جمع کل</span>
                    <strong>{money(receiptData?.summary?.grossTotal ?? receipt?.preview?.summary?.grossTotal)}</strong>
                  </div>
                  <div className="receipt-total-row">
                    <span>سهم سازمان ({faDigits(receiptData?.split?.organizationSharePercent ?? caps.organizationSharePercent)}٪)</span>
                    <strong>{money(receiptData?.summary?.organizationAmount ?? receipt?.preview?.summary?.organizationAmount)}</strong>
                  </div>
                  <div className="receipt-total-row receipt-total-row--pay">
                    <span>قابل پرداخت شما</span>
                    <strong>{money(receiptData?.summary?.personalAmount ?? receipt?.preview?.summary?.personalAmount)}</strong>
                  </div>
                </div>
                <div className="receipt-dash receipt-dash--dots" />
                <div className="receipt-footer">
                  این فیش صرفاً جهت اطلاع است و جایگزین سند حسابداری رسمی نیست.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
