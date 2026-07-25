import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { allowedAdminTabs, normalizeAdminCapabilities } from '../lib/portalCapabilities';
import { adminTabPath, tabFromPathname } from '../lib/adminPaths';

const TAB_META = {
  reports: { label: 'گزارش‌ها', icon: 'fa-chart-line', sub: 'گزارش هفتگی، پرسنلی و تامین‌کننده' },
  weeks: { label: 'هفته‌ها', icon: 'fa-calendar-week', sub: 'تعریف هفته و چیدمان منو' },
  orders: { label: 'سفارش‌ها', icon: 'fa-clipboard-list', sub: 'تایید و پیگیری سفارش‌ها' },
  guests: { label: 'مهمان‌ها', icon: 'fa-user-tag', sub: 'مهمان دائم و موقت' },
  foods: { label: 'غذاها', icon: 'fa-utensils', sub: 'فهرست و قیمت غذاها' },
  users: { label: 'کاربران', icon: 'fa-users', sub: 'پرسنل و نقش‌ها' },
  departments: { label: 'واحدها', icon: 'fa-building', sub: 'ساختار سازمانی' },
  finance: { label: 'مالی و حسابداری', icon: 'fa-coins', sub: 'سهم سازمان و صورتحساب' },
  announcements: { label: 'اطلاعیه', icon: 'fa-bullhorn', sub: 'پیام به کاربران' },
  backup: { label: 'پشتیبان', icon: 'fa-database', sub: 'خروجی و بازیابی داده‌ها' },
};

const MENU_GROUPS = [
  { id: 'main', label: 'اصلی', icon: 'fa-th-large', tabs: ['reports'] },
  { id: 'food-plan', label: 'برنامه غذایی', icon: 'fa-utensils', tabs: ['weeks', 'foods'] },
  { id: 'orders-guests', label: 'سفارش و مهمان', icon: 'fa-clipboard-list', tabs: ['orders', 'guests'] },
  { id: 'organization', label: 'سازمان', icon: 'fa-sitemap', tabs: ['users', 'departments'] },
  { id: 'finance-info', label: 'مالی و اطلاعیه', icon: 'fa-coins', tabs: ['finance', 'announcements'] },
  { id: 'system', label: 'سامانه', icon: 'fa-hard-drive', tabs: ['backup'] },
];

const SUPER_GROUP = { id: 'super', label: 'سوپر ادمین', icon: 'fa-shield-halved' };

const SUPER_LINKS = [
  { path: '/admin/super/settings', label: 'تنظیمات', icon: 'fa-sliders', feature: 'superSettings', sub: 'عمومی، ظرفیت، LDAP و ظاهر' },
  { path: '/admin/super/security', label: 'امنیت و لاگ', icon: 'fa-shield-halved', feature: 'security', sub: 'WAF و قفل حساب' },
];

const SUPER_PAGE_META = {
  '/admin/super/settings': SUPER_LINKS[0],
  '/admin/super/security': SUPER_LINKS[1],
};

function groupForTab(tab) {
  if (!tab) return null;
  return MENU_GROUPS.find((g) => g.tabs.includes(tab))?.id || null;
}

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [boot, setBoot] = useState(null);
  const [openGroups, setOpenGroups] = useState(() => new Set(['main']));

  const isSuperPath = location.pathname.startsWith('/admin/super/');
  const activeTab = isSuperPath ? null : tabFromPathname(location.pathname);
  const superMeta = SUPER_PAGE_META[location.pathname];
  const isGuests = activeTab === 'guests';

  useEffect(() => {
    document.body.classList.add('admin-body', 'admin-sidebar-only');
    return () => document.body.classList.remove('admin-body', 'admin-sidebar-only');
  }, []);

  useEffect(() => {
    document.body.classList.toggle('admin-guests-tab', isGuests);
    return () => document.body.classList.remove('admin-guests-tab');
  }, [isGuests]);

  useEffect(() => {
    api('/api/app/admin/bootstrap').then((res) => {
      if (res.success) {
        setBoot(res.data);
        return;
      }
      // Regular users opening /admin get FORBIDDEN_ROLE on every action
      if (res._httpStatus === 401 || res._httpStatus === 403 || res.code === 'FORBIDDEN_ROLE') {
        window.location.replace('/login?expired=1');
      }
    });
  }, []);

  useEffect(() => {
    const gid = groupForTab(activeTab);
    if (!gid) return;
    setOpenGroups((prev) => {
      if (prev.has(gid)) return prev;
      const next = new Set(prev);
      next.add(gid);
      return next;
    });
  }, [activeTab]);

  useEffect(() => {
    if (!isSuperPath) return;
    setOpenGroups((prev) => {
      if (prev.has('super')) return prev;
      const next = new Set(prev);
      next.add('super');
      return next;
    });
  }, [isSuperPath]);

  const adminCaps = useMemo(() => normalizeAdminCapabilities(boot?.capabilities, {
    isSuperadmin: boot?.isSuperadmin,
    role: boot?.currentUserRole,
    reportsAccess: boot?.reportsAccess,
  }), [boot]);

  const tabs = allowedAdminTabs(adminCaps);
  const isSuper = !!adminCaps.isSuperadmin;
  const superLinks = SUPER_LINKS.filter((l) => adminCaps.features?.[l.feature]);

  const tabMeta = activeTab ? TAB_META[activeTab] : null;
  const pageTitle = superMeta?.label || tabMeta?.label || '';
  const pageSub = superMeta?.sub || tabMeta?.sub || '';
  const pageIcon = superMeta?.icon || tabMeta?.icon || 'fa-cogs';

  function toggleGroup(id) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderSubLink(tab) {
    const meta = TAB_META[tab];
    if (!meta || !tabs.includes(tab)) return null;
    const active = activeTab === tab;
    return (
      <li key={tab} className="sidebar-nav-sub-item">
        <a
          href={adminTabPath(tab)}
          className={`sidebar-nav-sub-link${active ? ' is-active' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(adminTabPath(tab));
          }}
        >
          <span className="sidebar-nav-ico"><i className={`fas ${meta.icon}`} /></span>
          <span className="sidebar-nav-text">{meta.label}</span>
          {tab === 'reports' && !adminCaps.reportsAccess?.allowed && adminCaps.reportsAccess?.pendingCount > 0 && (
            <span className="badge badge-warning sidebar-pending-badge">
              {adminCaps.reportsAccess.pendingCount.toLocaleString('fa-IR')}
            </span>
          )}
        </a>
      </li>
    );
  }

  function renderGroup(group) {
    const visibleTabs = group.tabs.filter((t) => tabs.includes(t));
    if (!visibleTabs.length) return null;
    const isOpen = openGroups.has(group.id);

    return (
      <li key={group.id} className={`sidebar-nav-group${isOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="sidebar-nav-group-head"
          onClick={() => toggleGroup(group.id)}
          aria-expanded={isOpen}
        >
          <span className="sidebar-nav-ico"><i className={`fas ${group.icon}`} /></span>
          <span className="sidebar-nav-group-title">{group.label}</span>
          <i className={`fas ${isOpen ? 'fa-chevron-down' : 'fa-chevron-left'} sidebar-nav-chevron`} />
        </button>
        <ul className="sidebar-nav-sub">
          {visibleTabs.map((tab) => renderSubLink(tab))}
        </ul>
      </li>
    );
  }

  const todayFa = new Date().toLocaleDateString('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <>
      <aside className="sidebar sidebar-nav-panel">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon"><i className="fas fa-utensils" /></div>
          <div>
            <span className="sidebar-brand-text">{boot?.appSettings?.organizationName || 'سامانه تغذیه'}</span>
            <span className="sidebar-brand-sub">پنل مدیریت</span>
          </div>
        </div>

        <div className="sidebar-date-chip" title={todayFa}>
          <i className="far fa-calendar-check" />
          <span>{todayFa}</span>
        </div>

        <nav className="sidebar-nav-wrap" aria-label="منوی مدیریت">
          <ul className="sidebar-nav-menu">
            {MENU_GROUPS.map((group) => renderGroup(group))}

            {isSuper && superLinks.length > 0 && (
              <li className={`sidebar-nav-group${openGroups.has('super') ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="sidebar-nav-group-head"
                  onClick={() => toggleGroup('super')}
                  aria-expanded={openGroups.has('super')}
                >
                  <span className="sidebar-nav-ico"><i className={`fas ${SUPER_GROUP.icon}`} /></span>
                  <span className="sidebar-nav-group-title">{SUPER_GROUP.label}</span>
                  <i className={`fas ${openGroups.has('super') ? 'fa-chevron-down' : 'fa-chevron-left'} sidebar-nav-chevron`} />
                </button>
                <ul className="sidebar-nav-sub">
                  {superLinks.map((l) => (
                    <li key={l.path} className="sidebar-nav-sub-item">
                      <NavLink
                        to={l.path}
                        className={({ isActive }) => `sidebar-nav-sub-link${isActive ? ' is-active' : ''}`}
                      >
                        <span className="sidebar-nav-ico"><i className={`fas ${l.icon}`} /></span>
                        <span className="sidebar-nav-text">{l.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        </nav>

        <div className="sidebar-footer sidebar-footer--actions">
          <div className="sidebar-footer-user">
            <div className="user-avatar">م</div>
            <div className="sidebar-footer-info">
              <span className="sidebar-user-name">{boot?.currentUserRole === 'superadmin' ? 'سوپر ادمین' : 'مدیر سیستم'}</span>
              <span className="sidebar-user-role">{isSuper ? 'دسترسی کامل' : 'مدیر'}</span>
            </div>
          </div>
          <div className="sidebar-action-links">
            <Link to="/user/dashboard" className="sidebar-action-link sidebar-action-link--portal">
              <i className="fas fa-eye" /> مشاهده پرتال
            </Link>
            <a
              href="/logout"
              className="sidebar-action-link sidebar-action-link--logout"
              onClick={(e) => { e.preventDefault(); window.location.assign('/logout'); }}
            >
              <i className="fas fa-sign-out-alt" /> خروج
            </a>
          </div>
          {boot?.appVersionMajorFa && (
            <span className="sidebar-app-version">
              نسخه {boot.appVersionMajorFa}
              {boot.appVersion && String(boot.appVersion) !== String(boot.appVersionMajor) && ` (${boot.appVersionFa})`}
            </span>
          )}
        </div>
      </aside>

      <div className="main-content">
        <main className="content-wrapper">
          {pageTitle && !isGuests && (
            <div className="page-header page-header--compact">
              <div>
                <div className="ph-title">{pageTitle}</div>
                {pageSub && <div className="ph-sub">{pageSub}</div>}
              </div>
              <i className={`fas ${pageIcon} ph-icon`} />
            </div>
          )}
          <Outlet context={{ boot, adminCaps, reloadBoot: () => api('/api/app/admin/bootstrap').then((r) => { if (r.success) setBoot(r.data); }) }} />
        </main>
      </div>
    </>
  );
}
