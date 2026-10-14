import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiUrl } from '../api/client';
import { useToast } from '../components/ToastProvider';
import AppVersionBadge from '../components/AppVersionBadge';
import CategoryWeekMenuSlider from '../components/CategoryWeekMenuSlider';
import PortalProfilePanel from '../components/PortalProfilePanel';
import Pagination from '../components/admin/shared/Pagination';
import { useJalaliDatepicker } from '../hooks/useJalaliDatepicker';
import { normalizeUserCapabilities } from '../lib/portalCapabilities';
import { faDigits, jdate, money } from '../utils/format';
import PaymentModal from '../components/payment/PaymentModal';
import PaymentInvoice from '../components/payment/PaymentInvoice';
import ModalPortal from '../components/ModalPortal';
import {
  BILL_STATUS_CLASS,
  BILL_STATUS_LABEL,
  PAYMENT_PROVIDER_LABEL,
  PAYMENT_SCOPE_LABEL,
  PAYMENT_STATUS_CLASS,
  PAYMENT_STATUS_LABEL,
} from '../lib/payments';

const STATUS_LABEL = { pending: 'در انتظار تایید', confirmed: 'تایید شده', ready: 'آماده', completed: 'تحویل شده', cancelled: 'لغو شده' };
const STATUS_CLASS = { pending: 'warning', confirmed: 'primary', ready: 'success', completed: 'success', cancelled: 'danger' };
const ORDER_FILTER_DEFAULTS = {
  code: '',
  food: '',
  amount: '',
  orderDate: '',
  deliveryDate: '',
  status: '',
};

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
const PAY_CONFIG_OFF = { enabled: false, scopes: { cart: false, week: false, month: false }, methods: [], card: null };
const EMPTY_CART = { items: [], total: 0, reviewCount: 0 };

/**
 * guestMode: همین پرتال برای مهمان‌ها (مسیرهای API با setApiPathRewrite به /api/guest می‌روند)
 * onLogout: خروج سفارشی (مهمان)
 */
export default function UserDashboardPage({ guestMode = false, onLogout = null } = {}) {
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
  const [orderFilters, setOrderFilters] = useState(ORDER_FILTER_DEFAULTS);
  const [activeOrderFilter, setActiveOrderFilter] = useState('');
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
  const [payConfig, setPayConfig] = useState(PAY_CONFIG_OFF);
  const [cart, setCart] = useState(EMPTY_CART);
  const [cartUnselected, setCartUnselected] = useState(new Set());
  const [paySub, setPaySub] = useState('cart');
  const [payments, setPayments] = useState([]);
  const [paymentsPagination, setPaymentsPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [payTarget, setPayTarget] = useState(null);
  const [invoice, setInvoice] = useState(null);

  useJalaliDatepicker(tab === 'orders');

  useEffect(() => {
    document.body.className = 'user-portal-body';
    bootstrap();
    return () => {
      document.body.classList.remove('user-portal-body');
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('ann-drawer-open', drawerOpen || !!receipt || profileOpen || !!payTarget || !!invoice);
    return () => document.body.classList.remove('ann-drawer-open');
  }, [drawerOpen, receipt, profileOpen, payTarget, invoice]);

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
      const [boot, me, ann, pub, cats, pay] = await Promise.all([
        api('/api/app/user/bootstrap'),
        api('/api/auth/me'),
        api('/api/announcements/active'),
        api('/api/app/public'),
        api('/api/foods/categories'),
        api('/api/user/payments/config').catch(() => null),
      ]);
      const nextPay = pay?.success && pay.data?.enabled ? pay.data : PAY_CONFIG_OFF;
      setPayConfig(nextPay);
      if (nextPay.scopes.cart) loadCart();
      handlePaymentReturn(nextPay);
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

  // موبایل: تب فعال در نوار افقی دیده شود
  useEffect(() => {
    if (!window.matchMedia('(max-width: 900px)').matches) return undefined;
    const raf = requestAnimationFrame(() => {
      const nav = document.querySelector('.user-tabs');
      const el = nav?.querySelector('.tab-button.active');
      if (!nav || !el) return;
      const n = nav.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.left < n.left) nav.scrollBy({ left: r.left - n.left - 12, behavior: 'smooth' });
      else if (r.right > n.right) nav.scrollBy({ left: r.right - n.right + 12, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [tab]);

  useEffect(() => {
    if (tab === 'orders') loadOrdersPage(1);
    if (tab === 'payments') {
      if (payConfig.scopes.cart) loadCart();
      loadPayments(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // بعد از پرداخت در بله کاربر به همین صفحه برمی‌گردد — وضعیت را تازه کن
  useEffect(() => {
    if (!payConfig.enabled) return undefined;
    function onFocus() {
      if (document.visibilityState !== 'visible') return;
      if (payConfig.scopes.cart) loadCart();
      if (tab === 'payments') loadPayments(paymentsPagination.page);
      if (tab === 'statement') loadStatements();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payConfig, tab, paymentsPagination.page, stmtSub]);

  // تنظیمات «نمایش قیمت/صورتحساب» ممکن است در حین باز بودن پرتال تغییر کند
  useEffect(() => {
    let lastCheck = Date.now();
    async function refreshCaps() {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 15000) return;
      lastCheck = Date.now();
      try {
        const boot = await api('/api/app/user/bootstrap');
        if (boot.success) {
          const next = normalizeUserCapabilities({ ...boot.data.portalSettings, ...boot.data.capabilities });
          setCaps((prev) => {
            if (prev.showPrices !== next.showPrices) loadMenu();
            return next;
          });
        }
      } catch { /* ignore */ }
    }
    document.addEventListener('visibilitychange', refreshCaps);
    window.addEventListener('focus', refreshCaps);
    return () => {
      document.removeEventListener('visibilitychange', refreshCaps);
      window.removeEventListener('focus', refreshCaps);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab !== 'orders') return undefined;
    const timer = window.setTimeout(() => loadOrdersPage(1), 250);
    return () => window.clearTimeout(timer);
  }, [orderFilters, tab]);

  useEffect(() => {
    if (tab === 'statement' && caps.showStatement) {
      refreshStatementConfig().then(loadStatements);
    }
  }, [tab, stmtSub, caps.showStatement]);

  async function loadMenu(weekId = selectedWeekId) {
    const [weeksRes, lockOrdersRes] = await Promise.all([
      api('/api/menu/active-weeks'),
      api('/api/orders?activeWeeks=1'),
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
    const params = new URLSearchParams({ page: String(page), limit: '10' });
    Object.entries(orderFilters).forEach(([key, value]) => {
      const text = String(value || '').trim();
      if (text) params.set(key, text);
    });
    const res = await api(`/api/orders?${params.toString()}`);
    if (res.success) {
      setOrders(Array.isArray(res.data) ? res.data : []);
      setOrdersPagination(res.pagination || { page, totalPages: 1, total: (res.data || []).length });
      setOrdersPage(Number(res.pagination?.page || page));
    } else {
      setOrders([]);
      setOrdersPagination({ page: 1, totalPages: 1, total: 0 });
    }
  }

  function updateOrderFilter(key, value) {
    setOrderFilters((current) => ({ ...current, [key]: value }));
  }

  function resetOrderFilters() {
    setOrderFilters(ORDER_FILTER_DEFAULTS);
    setActiveOrderFilter('');
  }

  function clearOrderFilter(key) {
    setOrderFilters((current) => ({ ...current, [key]: '' }));
  }

  function renderOrderFilterControl(key) {
    const handleFilterInput = (event) => updateOrderFilter(key, event.target.value);
    const commonInputProps = {
      className: 'form-control',
      value: orderFilters[key],
      onChange: handleFilterInput,
      onInput: handleFilterInput,
    };

    if (key === 'status') {
      return (
        <select {...commonInputProps}>
          <option value="">همه وضعیت‌ها</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      );
    }

    const dateField = key === 'orderDate' || key === 'deliveryDate';
    return (
      <input
        {...commonInputProps}
        placeholder={dateField ? 'انتخاب تاریخ' : key === 'food' ? 'جستجوی غذا' : key === 'amount' ? 'مثلا ۱۰۰۰۰۰' : 'مثلا ۱۲۱'}
        inputMode={key === 'code' || key === 'amount' ? 'numeric' : undefined}
        dir={dateField ? 'ltr' : undefined}
        data-jdp={dateField ? true : undefined}
        data-jdp-only-date={dateField ? true : undefined}
        readOnly={dateField}
      />
    );
  }

  function renderOrderFilterHeader(key, label, icon) {
    const isOpen = activeOrderFilter === key;
    const isActive = Boolean(String(orderFilters[key] || '').trim());
    return (
      <th className="order-filter-th">
        <div className="order-filter-title">
          <span>{label}</span>
          <button
            type="button"
            className={`order-filter-trigger${isActive ? ' is-active' : ''}${isOpen ? ' is-open' : ''}`}
            aria-label={`فیلتر ${label}`}
            aria-expanded={isOpen}
            onClick={(event) => {
              event.stopPropagation();
              setActiveOrderFilter((current) => (current === key ? '' : key));
            }}
          >
            <i className={icon || 'fas fa-filter'} />
          </button>
        </div>
        {isOpen && (
          <div className="order-filter-popover" onClick={(event) => event.stopPropagation()}>
            <div className="order-filter-popover-head">
              <strong>فیلتر {label}</strong>
              <button type="button" className="order-filter-popover-close" onClick={() => setActiveOrderFilter('')} aria-label="بستن">
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="order-filter-popover-control">
              {renderOrderFilterControl(key)}
            </div>
            <div className="order-filter-popover-actions">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => clearOrderFilter(key)} disabled={!isActive}>
                پاک کردن
              </button>
            </div>
          </div>
        )}
      </th>
    );
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

  async function loadCart() {
    const res = await api('/api/user/payments/cart').catch(() => null);
    setCart(res?.success ? (res.data || EMPTY_CART) : EMPTY_CART);
  }

  async function loadPayments(page = 1) {
    const res = await api(`/api/user/payments?page=${page}&limit=10`).catch(() => null);
    if (res?.success) {
      setPayments(res.data || []);
      setPaymentsPagination(res.pagination || { page, totalPages: 1, total: 0 });
    } else {
      setPayments([]);
    }
  }

  async function openInvoice(paymentId) {
    const res = await api(`/api/user/payments/${encodeURIComponent(paymentId)}`).catch(() => null);
    if (res?.success) setInvoice(res.data);
    else toast(res?.message || 'دریافت صورتحساب پرداخت ناموفق بود', 'error');
  }

  /** بازگشت از درگاه: /user/dashboard?payment=<id>&result=ok|fail */
  function handlePaymentReturn(config) {
    const params = new URLSearchParams(window.location.search);
    const paymentId = params.get('payment');
    const result = params.get('result');
    if (!result) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (!config.enabled) return;
    setPaySub('history');
    setTab('payments');
    if (result === 'ok') toast('پرداخت با موفقیت انجام شد و صورتحساب پرداخت‌شده صادر شد', 'success');
    else toast('پرداخت انجام نشد. در صورت کسر وجه، مبلغ توسط بانک برگشت داده می‌شود.', 'error');
    if (paymentId && /^[a-f0-9]{24}$/i.test(paymentId)) openInvoice(paymentId);
  }

  function openStatementPayment(s) {
    const periodType = s.periodType === 'month' ? 'month' : 'week';
    setPayTarget({
      scope: periodType,
      periodKey: s.periodKey,
      title: `${PAYMENT_SCOPE_LABEL[periodType]} ${s.range?.jalaliStart || ''} تا ${s.range?.jalaliEnd || ''}`,
      amount: s.payment?.remaining || 0,
    });
  }

  const cartSelectedItems = cart.items.filter((item) => !cartUnselected.has(String(item.orderId)));
  const cartSelectedTotal = cartSelectedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  function toggleCartItem(orderId) {
    setCartUnselected((current) => {
      const next = new Set(current);
      const key = String(orderId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openCartPayment() {
    if (!cartSelectedItems.length) return toast('حداقل یک سفارش را انتخاب کنید', 'error');
    setPayTarget({
      scope: 'cart',
      orderIds: cartSelectedItems.map((item) => String(item.orderId)),
      title: `سبد خرید — ${faDigits(cartSelectedItems.length)} سفارش`,
      amount: cartSelectedTotal,
    });
  }

  async function onPaymentDone(payment) {
    setPayTarget(null);
    setCartUnselected(new Set());
    if (payConfig.scopes.cart) await loadCart();
    if (tab === 'statement') await loadStatements();
    setPaySub('history');
    if (tab === 'payments') await loadPayments(1);
    else goTab('payments');
    if (payment?._id) setInvoice(payment);
  }

  async function placeOrder(menuItemId) {
    if (pendingItems.has(menuItemId)) return;
    setPendingItems((s) => new Set(s).add(menuItemId));
    try {
      const data = await api('/api/orders', { method: 'POST', body: JSON.stringify({ menuItemId }) });
      if (!data.success) return toast(data.message || 'ثبت سفارش ناموفق بود', 'error');
      toast(
        payConfig.scopes.cart
          ? 'رزرو ثبت شد و به سبد خرید اضافه شد'
          : (data.message || 'رزرو شما با موفقیت ثبت شد'),
        'success',
      );
      if (payConfig.scopes.cart) loadCart();
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
    if (payConfig.scopes.cart) loadCart();
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

  // ستون/دکمه پرداخت صورتحساب فقط وقتی پرداخت همان نوع (هفتگی/ماهیانه) فعال است
  const stmtPayOn = payConfig.enabled && !!payConfig.scopes[stmtSub === 'monthly' ? 'month' : 'week'];
  const showAdminLink = !guestMode && isAdminRole(user?.role);
  const receiptData = receipt?.detail;
  const orgName = version?.organizationName || 'سامانه تغذیه';
  const hasOrderFilters = Object.values(orderFilters).some((value) => String(value || '').trim());
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
              <img src="/img/logo.svg" alt="" />
            </div>
            <div>
              <span className="user-side-nav-head">{orgName}</span>
              <span className="user-side-nav-sub">{guestMode ? 'پرتال مهمان' : 'پرتال کارکنان'}</span>
            </div>
          </div>

          <nav className="user-tabs user-tabs--vertical" role="tablist" aria-label="بخش‌های پرتال">
            <div className={`user-nav-group is-open${tab === 'menu' ? ' is-active' : ''}`}>
              <button type="button" role="tab" aria-selected={tab === 'menu'} className={`tab-button${tab === 'menu' ? ' active' : ''}`} onClick={() => goTab('menu')}>
                <span className="tab-button-ico"><i className="fas fa-utensils" /></span>
                <span className="tab-button-copy">
                  <span className="tab-button-label">رزرو غذا</span>
                </span>
              </button>
              {activeWeeks.length > 0 && (
                <div className="user-nav-sub" role="group" aria-label="هفته‌های فعال">
                  {activeWeeks.map((w) => {
                    const id = String(w._id);
                    const label = w.name || `${w.jalaliStart} تا ${w.jalaliEnd}`;
                    const isSelected = tab === 'menu' && String(selectedWeekId) === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`user-nav-sub-link${isSelected ? ' is-active' : ''}`}
                        onClick={() => {
                          goTab('menu');
                          selectWeek(id);
                        }}
                        title={label}
                      >
                        <i className="fas fa-calendar-week" aria-hidden="true" />
                        <span>{w.jalaliStart} تا {w.jalaliEnd}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
            {payConfig.enabled && (
              <button type="button" role="tab" aria-selected={tab === 'payments'} className={`tab-button${tab === 'payments' ? ' active' : ''}`} onClick={() => goTab('payments')}>
                <span className="tab-button-ico"><i className="fas fa-wallet" /></span>
                <span className="tab-button-copy">
                  <span className="tab-button-label">پرداخت</span>
                  <span className="tab-button-hint">{payConfig.scopes.cart ? 'سبد خرید و سوابق' : 'سوابق پرداخت'}</span>
                </span>
                {payConfig.scopes.cart && cart.items.length > 0 && (
                  <span className="tab-button-badge" aria-label={`${cart.items.length} مورد در سبد خرید`}>{faDigits(cart.items.length)}</span>
                )}
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
                  {!guestMode && (
                    <button type="button" role="menuitem" className="portal-user-menu-item" onClick={openProfile}>
                      <i className="fas fa-user-gear" />
                      <span>تنظیمات حساب</span>
                    </button>
                  )}
                  {showAdminLink && (
                    <Link to="/admin/reports" role="menuitem" className="portal-user-menu-item" onClick={() => setUserMenuOpen(false)}>
                      <i className="fas fa-cogs" />
                      <span>پنل مدیریت</span>
                    </Link>
                  )}
                  {onLogout ? (
                    <button type="button" role="menuitem" className="portal-user-menu-item portal-user-menu-item--danger" onClick={onLogout}>
                      <i className="fas fa-power-off" />
                      <span>خروج</span>
                    </button>
                  ) : (
                    <a href="/logout" role="menuitem" className="portal-user-menu-item portal-user-menu-item--danger">
                      <i className="fas fa-power-off" />
                      <span>خروج</span>
                    </a>
                  )}
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
                </div>
              </header>
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
              {payConfig.scopes.cart && cart.items.length > 0 && (
                <div className="cart-bar" role="status">
                  <span className="cart-bar-ico"><i className="fas fa-basket-shopping" /></span>
                  <span className="cart-bar-copy">
                    <strong>{faDigits(cart.items.length)} سفارش در سبد خرید</strong>
                    <span>مجموع سهم شما: {money(cart.total)}</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => { setPaySub('cart'); goTab('payments'); }}
                  >
                    <i className="fas fa-wallet" /> مشاهده و پرداخت
                  </button>
                </div>
              )}
            </section>
          )}

          {!loading && tab === 'orders' && (
            <section className="tab-panel active">
              <header className="portal-stage-header portal-stage-header--compact">
                <h1 className="portal-stage-title">سفارش‌های من</h1>
                {hasOrderFilters && (
                  <button type="button" className="btn btn-outline btn-sm order-filter-clear-all" onClick={resetOrderFilters}>
                    <i className="fas fa-filter-circle-xmark" /> پاک‌سازی فیلترها
                  </button>
                )}
              </header>
              <div className="table-wrap">
                <div className="order-filter-panel" aria-label="فیلتر سفارش‌ها">
                  <div className="order-filter-head">
                    <span className="order-filter-head-icon"><i className="fas fa-filter" /></span>
                    <div>
                      <strong>فیلتر سفارش‌ها</strong>
                      <span>{hasOrderFilters ? `${faDigits(ordersPagination.total)} رکورد مطابق فیلتر` : 'جستجو در کد، غذا، مبلغ، تاریخ و وضعیت'}</span>
                    </div>
                  </div>
                  <div className="order-filter-grid">
                    <label className="order-filter-field">
                      <span>کد</span>
                      <div className="order-filter-control">
                        <i className="fas fa-hashtag" />
                        <input
                          className="form-control"
                          value={orderFilters.code}
                          onChange={(e) => updateOrderFilter('code', e.target.value)}
                          placeholder="۱۲۱"
                          inputMode="numeric"
                        />
                      </div>
                    </label>
                    <label className="order-filter-field">
                      <span>غذا</span>
                      <div className="order-filter-control">
                        <i className="fas fa-bowl-food" />
                        <input
                          className="form-control"
                          value={orderFilters.food}
                          onChange={(e) => updateOrderFilter('food', e.target.value)}
                          placeholder="نام غذا"
                        />
                      </div>
                    </label>
                    {caps.showPrices && (
                      <label className="order-filter-field">
                        <span>مبلغ</span>
                        <div className="order-filter-control">
                          <i className="fas fa-money-bill-wave" />
                          <input
                            className="form-control"
                            value={orderFilters.amount}
                            onChange={(e) => updateOrderFilter('amount', e.target.value)}
                            placeholder="۱۰۰۰۰۰"
                            inputMode="numeric"
                          />
                        </div>
                      </label>
                    )}
                    <label className="order-filter-field">
                      <span>تاریخ ثبت</span>
                      <div className="order-filter-control order-filter-control--date">
                        <i className="fas fa-calendar-plus" />
                        <input
                          className="form-control"
                          value={orderFilters.orderDate}
                          onChange={(e) => updateOrderFilter('orderDate', e.target.value)}
                          placeholder="انتخاب تاریخ"
                          dir="ltr"
                          data-jdp
                          data-jdp-only-date
                          readOnly
                        />
                      </div>
                    </label>
                    <label className="order-filter-field">
                      <span>تاریخ تحویل</span>
                      <div className="order-filter-control order-filter-control--date">
                        <i className="fas fa-calendar-check" />
                        <input
                          className="form-control"
                          value={orderFilters.deliveryDate}
                          onChange={(e) => updateOrderFilter('deliveryDate', e.target.value)}
                          placeholder="انتخاب تاریخ"
                          dir="ltr"
                          data-jdp
                          data-jdp-only-date
                          readOnly
                        />
                      </div>
                    </label>
                    <label className="order-filter-field">
                      <span>وضعیت</span>
                      <div className="order-filter-control">
                        <i className="fas fa-circle-check" />
                        <select
                          className="form-control"
                          value={orderFilters.status}
                          onChange={(e) => updateOrderFilter('status', e.target.value)}
                        >
                          <option value="">همه وضعیت‌ها</option>
                          {Object.entries(STATUS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </label>
                  </div>
                  <div className="order-filter-actions">
                    <button type="button" className="btn btn-outline btn-sm order-filter-reset" onClick={resetOrderFilters} disabled={!hasOrderFilters}>
                      <i className="fas fa-filter-circle-xmark" /> پاک‌سازی فیلتر
                    </button>
                  </div>
                </div>
                {!orders.length && !hasOrderFilters ? (
                  <div className="orders-empty">
                    <i className="fas fa-receipt" />
                    <p>هنوز سفارشی ثبت نکرده‌اید.</p>
                  </div>
                ) : (
                  <>
                    <table className="table">
                      <thead>
                        <tr>
                          {renderOrderFilterHeader('code', 'کد', 'fas fa-hashtag')}
                          {renderOrderFilterHeader('food', 'غذا', 'fas fa-bowl-food')}
                          {caps.showPrices && renderOrderFilterHeader('amount', 'مبلغ', 'fas fa-money-bill-wave')}
                          {renderOrderFilterHeader('orderDate', 'تاریخ ثبت', 'fas fa-calendar-plus')}
                          {renderOrderFilterHeader('deliveryDate', 'تاریخ تحویل', 'fas fa-calendar-check')}
                          {renderOrderFilterHeader('status', 'وضعیت', 'fas fa-circle-check')}
                        </tr>
                      </thead>
                      <tbody>
                        {orders.length ? orders.map((o) => (
                          <tr key={o._id}>
                            <td>#{o.orderNumber || '-'}</td>
                            <td>{o.menuItemId?.foodId?.name || o.foodId?.name || '-'}</td>
                            {caps.showPrices && <td>{money(o.totalPrice)}</td>}
                            <td>{jdate(o.orderDate)}</td>
                            <td>{o.deliveryDate ? jdate(o.deliveryDate) : '—'}</td>
                            <td><span className={`badge badge-${STATUS_CLASS[o.status] || 'gray'}`}>{payConfig.scopes.cart && o.status === 'pending' ? 'در انتظار پرداخت' : (STATUS_LABEL[o.status] || o.status)}</span></td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={caps.showPrices ? 6 : 5} className="order-filter-empty-row">
                              رکوردی با این فیلترها پیدا نشد.
                            </td>
                          </tr>
                        )}
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
                <span className="statement-range">
                  {payConfig.scopes.cart
                    ? 'سفارش‌ها پس از پرداخت خودکار تایید می‌شوند'
                    : 'فقط سفارش‌های تاییدشده در صورتحساب لحاظ می‌شوند'}
                </span>
              </div>
              <div className="table-wrap">
                {!statements.length ? <div className="orders-empty"><p>صورتحسابی ثبت نشده است.</p></div> : (
                  <table className="table statement-table">
                    <thead>
                      <tr>
                        <th>شناسه</th>
                        <th>بازه</th>
                        <th>قیمت صورتحساب</th>
                        {stmtPayOn && <th>وضعیت پرداخت</th>}
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
                          {stmtPayOn && (
                            <td>
                              <span className={`badge badge-${BILL_STATUS_CLASS[s.payment?.status] || 'gray'}`}>
                                {BILL_STATUS_LABEL[s.payment?.status] || '—'}
                              </span>
                              {s.payment?.status === 'partial' && (
                                <div className="statement-pay-remaining">مانده: {money(s.payment.remaining)}</div>
                              )}
                            </td>
                          )}
                          <td>
                            <div className="statement-actions">
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => openReceipt(s)}>
                                <i className="fas fa-receipt" /> نمایش بیشتر
                              </button>
                              {stmtPayOn
                                && Number(s.payment?.remaining) > 0
                                && s.payment?.status !== 'review' && (
                                <button type="button" className="btn btn-primary btn-sm" onClick={() => openStatementPayment(s)}>
                                  <i className="fas fa-wallet" /> پرداخت
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {!loading && tab === 'payments' && payConfig.enabled && (
            <section className="tab-panel active">
              <header className="portal-stage-header portal-stage-header--compact">
                <h1 className="portal-stage-title">پرداخت</h1>
              </header>
              <div className="sub-tabs" style={{ marginBottom: 16 }}>
                {payConfig.scopes.cart && (
                  <button type="button" className={`sub-tab-btn${paySub === 'cart' ? ' active' : ''}`} onClick={() => setPaySub('cart')}>
                    <i className="fas fa-basket-shopping" /> سبد خرید{cart.items.length ? ` (${faDigits(cart.items.length)})` : ''}
                  </button>
                )}
                <button type="button" className={`sub-tab-btn${paySub === 'history' || !payConfig.scopes.cart ? ' active' : ''}`} onClick={() => setPaySub('history')}>
                  <i className="fas fa-file-invoice-dollar" /> صورتحساب‌های پرداخت
                </button>
              </div>

              {payConfig.scopes.cart && paySub === 'cart' && (
                <div className="table-wrap">
                  {cart.reviewCount > 0 && (
                    <div className="statement-split-banner">
                      <i className="fas fa-hourglass-half" /> {faDigits(cart.reviewCount)} سفارش با رسید ثبت‌شده در انتظار تایید مدیر است.
                    </div>
                  )}
                  {!cart.items.length ? (
                    <div className="orders-empty">
                      <i className="fas fa-basket-shopping" />
                      <p>سبد خرید شما خالی است؛ پس از رزرو غذا، سفارش‌ها اینجا برای پرداخت قرار می‌گیرند.</p>
                    </div>
                  ) : (
                    <>
                      <table className="table cart-table">
                        <thead>
                          <tr>
                            <th style={{ width: 40 }}>
                              <input
                                type="checkbox"
                                aria-label="انتخاب همه"
                                checked={cartUnselected.size === 0}
                                onChange={(e) => setCartUnselected(e.target.checked ? new Set() : new Set(cart.items.map((i) => String(i.orderId))))}
                              />
                            </th>
                            <th>کد</th>
                            <th>غذا</th>
                            <th>تاریخ تحویل</th>
                            <th>وضعیت سفارش</th>
                            <th>سهم شما</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cart.items.map((item) => {
                            const key = String(item.orderId);
                            return (
                              <tr key={key} className={cartUnselected.has(key) ? 'is-unselected' : ''}>
                                <td><input type="checkbox" aria-label="انتخاب" checked={!cartUnselected.has(key)} onChange={() => toggleCartItem(key)} /></td>
                                <td>#{item.orderNumber || '-'}</td>
                                <td>{item.foodName}</td>
                                <td>{item.jalaliDate}</td>
                                <td><span className={`badge badge-${STATUS_CLASS[item.status] || 'gray'}`}>{item.status === 'pending' ? 'در انتظار پرداخت' : (STATUS_LABEL[item.status] || item.status)}</span></td>
                                <td className="statement-personal-col">{money(item.amount)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="cart-footer">
                        <div className="cart-footer-total">
                          <span>جمع قابل پرداخت ({faDigits(cartSelectedItems.length)} سفارش)</span>
                          <strong>{money(cartSelectedTotal)}</strong>
                        </div>
                        <button type="button" className="btn btn-primary" onClick={openCartPayment} disabled={!cartSelectedItems.length}>
                          <i className="fas fa-wallet" /> پرداخت
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {(paySub === 'history' || !payConfig.scopes.cart) && (
                <div className="table-wrap">
                  {!payments.length ? (
                    <div className="orders-empty">
                      <i className="fas fa-file-invoice-dollar" />
                      <p>هنوز پرداختی ثبت نکرده‌اید.</p>
                    </div>
                  ) : (
                    <>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>شماره</th>
                            <th>بابت</th>
                            <th>مبلغ</th>
                            <th>روش</th>
                            <th>تاریخ</th>
                            <th>وضعیت</th>
                            <th>عملیات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map((p) => (
                            <tr key={p._id}>
                              <td className="statement-number-col">{p.code}</td>
                              <td>
                                {PAYMENT_SCOPE_LABEL[p.scope] || p.scope}
                                {p.scope !== 'cart' && p.periodLabel && (
                                  <div className="statement-pay-remaining">{p.periodLabel.replace(/^صورتحساب (هفتگی|ماهیانه) /, '')}</div>
                                )}
                              </td>
                              <td>{money(p.amount)}</td>
                              <td>{PAYMENT_PROVIDER_LABEL[p.provider] || p.method}</td>
                              <td>{jdate(p.createdAt)}</td>
                              <td><span className={`badge badge-${PAYMENT_STATUS_CLASS[p.status] || 'gray'}`}>{p.statusLabel || PAYMENT_STATUS_LABEL[p.status]}</span></td>
                              <td>
                                <div className="statement-actions">
                                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setInvoice(p)}>
                                    <i className="fas fa-receipt" /> {p.status === 'paid' ? 'صورتحساب' : 'جزئیات'}
                                  </button>
                                  {p.status === 'initiated' && p.checkoutUrl && (
                                    <a className="btn btn-primary btn-sm" href={p.checkoutUrl}>
                                      <i className="fas fa-arrow-up-right-from-square" /> ادامه پرداخت
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <Pagination
                        page={paymentsPagination.page}
                        totalPages={paymentsPagination.totalPages}
                        total={paymentsPagination.total}
                        onPage={(pg) => loadPayments(pg)}
                      />
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {!guestMode && <PortalProfilePanel
            open={profileOpen}
            user={user}
            onClose={() => setProfileOpen(false)}
            onUserUpdate={(next) => setUser((prev) => ({ ...prev, ...next }))}
          />}
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

      {payTarget && (
        <PaymentModal
          target={payTarget}
          config={payConfig}
          onClose={() => setPayTarget(null)}
          onDone={onPaymentDone}
        />
      )}

      {invoice && (
        <PaymentInvoice
          payment={invoice}
          orgName={orgName}
          receiptUrl={apiUrl(`/api/user/payments/${encodeURIComponent(invoice._id)}/receipt`)}
          onClose={() => setInvoice(null)}
        />
      )}

      {(receipt || receiptLoading) && (
        <ModalPortal>
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
                  {(() => {
                    const discountAmount = Number(
                      receiptData?.summary?.discountAmount
                      ?? receiptData?.discountAmount
                      ?? receipt?.preview?.summary?.discountAmount
                      ?? receipt?.preview?.discountAmount
                      ?? 0,
                    );
                    const discountPercent = Number(
                      receiptData?.summary?.discountPercent
                      ?? receiptData?.discountPercent
                      ?? receipt?.preview?.summary?.discountPercent
                      ?? receipt?.preview?.discountPercent
                      ?? 0,
                    );
                    const hasDiscount = discountAmount > 0
                      || discountPercent > 0
                      || receiptData?.hasDiscount
                      || receipt?.preview?.hasDiscount;
                    if (!hasDiscount) return null;
                    return (
                      <div className="receipt-total-row receipt-total-row--discount">
                        <span>
                          تخفیف
                          {discountPercent > 0 ? ` ${faDigits(discountPercent)}٪` : ''}
                          {' '}(−{money(discountAmount)})
                        </span>
                      </div>
                    );
                  })()}
                  <div className="receipt-total-row receipt-total-row--pay">
                    <span>قابل پرداخت شما</span>
                    <strong>{money(receiptData?.summary?.personalAmount ?? receipt?.preview?.summary?.personalAmount)}</strong>
                  </div>
                  {stmtPayOn && receipt?.preview?.payment && (
                    <>
                      <div className="receipt-total-row">
                        <span>پرداخت شده</span>
                        <strong>{money(receipt.preview.payment.paidAmount)}</strong>
                      </div>
                      <div className="receipt-total-row">
                        <span>مانده</span>
                        <strong>{money(receipt.preview.payment.remaining)}</strong>
                      </div>
                    </>
                  )}
                </div>
                <div className="receipt-dash receipt-dash--dots" />
                <div className="receipt-footer">
                  این فیش صرفاً جهت اطلاع است و جایگزین سند حسابداری رسمی نیست.
                </div>
              </div>
            )}
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}
