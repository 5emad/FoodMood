import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';
import { normalizeUserCapabilities } from '../lib/portalCapabilities';
import { esc, faDigits, jdate, money } from '../utils/format';

const STATUS_LABEL = { pending: 'در انتظار تایید', confirmed: 'تایید شده', ready: 'آماده', completed: 'تحویل شده', cancelled: 'لغو شده' };
const STATUS_CLASS = { pending: 'warning', confirmed: 'primary', ready: 'success', completed: 'success', cancelled: 'danger' };

export default function UserDashboardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState('menu');
  const [user, setUser] = useState(null);
  const [caps, setCaps] = useState(normalizeUserCapabilities({}));
  const [menu, setMenu] = useState(null);
  const [orders, setOrders] = useState([]);
  const [statements, setStatements] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingItems, setPendingItems] = useState(new Set());
  const [stmtSub, setStmtSub] = useState('weekly');
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    document.body.className = '';
    bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    try {
      const [boot, me, ann] = await Promise.all([
        api('/api/app/user/bootstrap'),
        api('/api/auth/me'),
        api('/api/announcements/active'),
      ]);
      if (boot.success) setCaps(normalizeUserCapabilities({ ...boot.data.portalSettings, ...boot.data.capabilities }));
      if (me.success) setUser(me.user);
      if (ann.success) setAnnouncements((ann.data || []).filter((a) => a.title && a.body));
      await loadMenu();
    } finally {
      setLoading(false);
    }
  }

  async function loadMenu() {
    const [menuRes, ordersRes] = await Promise.all([
      api('/api/menu/active'),
      api('/api/orders'),
    ]);
    if (!menuRes.success) {
      setMenu(null);
      return;
    }
    setMenu(menuRes.data);
    setOrders(ordersRes.success ? ordersRes.data : []);
    const pricesOn = menuRes.data?.settings?.showPricesToUsers !== false;
    const stmtOn = menuRes.data?.settings?.showFinancialStatementToUsers !== false;
    setCaps((c) => ({ ...c, showPrices: pricesOn, showStatement: stmtOn }));
  }

  async function loadStatements() {
    const data = await api(`/api/user/statement/list?type=${stmtSub}`);
    if (data.success) setStatements(data.data || []);
    else setStatements([]);
  }

  useEffect(() => {
    if (tab === 'statement' && caps.showStatement) loadStatements();
  }, [tab, stmtSub, caps.showStatement]);

  async function placeOrder(menuItemId) {
    if (pendingItems.has(menuItemId)) return;
    setPendingItems((s) => new Set(s).add(menuItemId));
    try {
      const data = await api('/api/orders', { method: 'POST', body: JSON.stringify({ menuItemId }) });
      if (!data.success) return toast(data.message || 'ثبت سفارش ناموفق بود', 'error');
      toast(data.message || 'رزرو شما با موفقیت ثبت شد', 'success');
      await loadMenu();
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
    await loadMenu();
  }

  const orderedDayIds = new Set(orders.filter((o) => o.status !== 'cancelled').map((o) => String(o.dailyMenuId?._id || o.dailyMenuId || '')));
  const orderByItem = {};
  orders.filter((o) => o.status !== 'cancelled' && o.menuItemId).forEach((o) => {
    orderByItem[String(o.menuItemId._id || o.menuItemId)] = o;
  });

  return (
    <>
      <nav className="top-nav">
        <div className="nav-brand">
          <div className="nav-brand-icon"><i className="fas fa-utensils" /></div>
          <div>
            <div className="nav-brand-title">اتوماسیون تغذیه</div>
            <span className="nav-brand-sub">پرتال کارکنان</span>
          </div>
        </div>
        <div className="nav-user">
          <div className="nav-user-info">
            <span className="nav-u-name">{user?.fullName || user?.username || 'همکار گرامی'}</span>
            <span className="nav-u-dept">{user?.department?.name || 'واحد عمومی'}</span>
          </div>
          <a href="/logout" className="btn-icon logout-btn" title="خروج"><i className="fas fa-power-off" /></a>
        </div>
      </nav>

      <main className="user-portal-shell">
        <div className="user-portal-main">
          <div className="page-header" style={{ marginBottom: 28 }}>
            <div>
              <div className="ph-badge"><i className="fas fa-calendar-week" /> هفته جاری</div>
              <div className="ph-title">برنامه غذایی هفته</div>
              <div className="ph-sub">{menu?.week ? (menu.week.name || `${jdate(menu.week.startDate)} تا ${jdate(menu.week.endDate)}`) : 'در حال بارگذاری...'}</div>
            </div>
            <i className="fas fa-bowl-food ph-icon" />
          </div>

          <div className="user-tabs">
            <button type="button" className={`tab-button${tab === 'menu' ? ' active' : ''}`} onClick={() => setTab('menu')}><i className="fas fa-calendar-days" /> منوی هفته</button>
            <button type="button" className={`tab-button${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}><i className="fas fa-receipt" /> سفارش‌های من</button>
            {caps.showStatement && (
              <button type="button" className={`tab-button${tab === 'statement' ? ' active' : ''}`} onClick={() => setTab('statement')}><i className="fas fa-file-invoice-dollar" /> صورتحساب</button>
            )}
          </div>

          {loading && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}

          {!loading && tab === 'menu' && (
            <section className="tab-panel active">
              <div className="menu-grid">
                {!menu && <div className="empty-state"><i className="fas fa-calendar-xmark" /><p>برنامه غذایی فعالی وجود ندارد.</p></div>}
                {menu?.days?.map((day) => {
                  const dayLocked = orderedDayIds.has(String(day._id));
                  return (
                    <div key={day._id} className="day-card">
                      <div className="day-card-header">
                        <span className="day-name">{day.dayId?.name || ''}</span>
                        <span className="day-date-badge">{jdate(day.date)}</span>
                      </div>
                      <div className="day-card-body">
                        {day.items?.length ? day.items.map((item) => {
                          const cap = Number(item.effectiveCapacity) || Number(menu.settings?.defaultMenuItemCapacity) || 0;
                          const full = cap > 0 && item.reservedCount >= cap;
                          const order = orderByItem[String(item._id)];
                          return (
                            <div key={item._id} className="food-row">
                              <div>
                                <div className="food-name">{item.foodId?.name || '-'}</div>
                                {caps.showPrices && <div className="food-price">{money(item.price)}</div>}
                              </div>
                              <div className="menu-actions">
                                {order ? (
                                  order.canCancel
                                    ? <button type="button" className="btn-cancel-order" onClick={() => cancelOrder(order._id)}><i className="fas fa-xmark" /> لغو رزرو</button>
                                    : <span className="status-confirmed"><i className="fas fa-check" /> تایید شده</span>
                                ) : dayLocked ? (
                                  <button type="button" className="btn-reserve" disabled>سفارش دارید</button>
                                ) : (
                                  <button type="button" className="btn-reserve" disabled={full || pendingItems.has(item._id)} onClick={() => placeOrder(item._id)}>
                                    {full ? 'تکمیل' : 'رزرو'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        }) : <div className="day-empty"><p>غذایی برای این روز ثبت نشده</p></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {!loading && tab === 'orders' && (
            <section className="tab-panel active">
              <div className="table-wrap">
                {!orders.length ? <div className="orders-empty"><i className="fas fa-receipt" /><p>هنوز سفارشی ثبت نکرده‌اید.</p></div> : (
                  <table className="table">
                    <thead><tr><th>کد</th><th>غذا</th>{caps.showPrices && <th>مبلغ</th>}<th>تاریخ</th><th>وضعیت</th></tr></thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o._id}>
                          <td>#{o.orderNumber || '-'}</td>
                          <td>{o.menuItemId?.foodId?.name || o.foodId?.name || '-'}</td>
                          {caps.showPrices && <td>{money(o.totalPrice)}</td>}
                          <td>{jdate(o.orderDate)}</td>
                          <td><span className={`badge badge-${STATUS_CLASS[o.status] || 'gray'}`}>{STATUS_LABEL[o.status] || o.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {!loading && tab === 'statement' && caps.showStatement && (
            <section className="tab-panel active">
              <div className="sub-tabs" style={{ marginBottom: 16 }}>
                <button type="button" className={`sub-tab-btn${stmtSub === 'weekly' ? ' active' : ''}`} onClick={() => setStmtSub('weekly')}>هفتگی</button>
                <button type="button" className={`sub-tab-btn${stmtSub === 'monthly' ? ' active' : ''}`} onClick={() => setStmtSub('monthly')}>ماهیانه</button>
              </div>
              <div className="table-wrap">
                {!statements.length ? <div className="orders-empty"><p>صورتحسابی ثبت نشده است.</p></div> : (
                  <table className="table">
                    <thead><tr><th>شماره</th><th>بازه</th><th>وعده</th><th>کل</th><th>سازمان</th><th>شخص</th></tr></thead>
                    <tbody>
                      {statements.map((s) => (
                        <tr key={s._id || s.statementNumber}>
                          <td>{s.statementNumber || '-'}</td>
                          <td>{s.title || `${s.range?.jalaliStart || ''} - ${s.range?.jalaliEnd || ''}`}</td>
                          <td>{faDigits(s.summary?.mealCount || 0)}</td>
                          <td>{money(s.summary?.totalAmount)}</td>
                          <td>{money(s.summary?.organizationShare)}</td>
                          <td>{money(s.summary?.personalShare)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}
        </div>
      </main>

      {announcements.length > 0 && (
        <div className="announcements-ui">
          <button type="button" className="ann-fab" onClick={() => setDrawerOpen(true)}>
            <i className="fas fa-bullhorn" />
            <span className="ann-fab-count">{faDigits(announcements.length)}</span>
          </button>
          {drawerOpen && (
            <>
              <div className="ann-drawer-overlay" onClick={() => setDrawerOpen(false)} />
              <div className="ann-drawer is-open">
                <div className="ann-drawer-header">
                  <div className="ann-drawer-title"><i className="fas fa-bullhorn" /> اطلاعیه‌های فعال</div>
                  <button type="button" className="btn-icon" onClick={() => setDrawerOpen(false)}><i className="fas fa-times" /></button>
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
    </>
  );
}
