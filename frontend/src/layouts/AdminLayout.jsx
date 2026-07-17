import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { allowedAdminTabs, normalizeAdminCapabilities } from '../lib/portalCapabilities';
import { adminTabPath, tabFromPathname } from '../lib/adminPaths';

const TAB_META = {
  reports: { label: 'گزارش‌ها', icon: 'fa-chart-line' },
  weeks: { label: 'هفته‌ها', icon: 'fa-calendar-week' },
  orders: { label: 'سفارش‌ها', icon: 'fa-clipboard-list' },
  guests: { label: 'مهمان‌ها', icon: 'fa-user-tag' },
  foods: { label: 'غذاها', icon: 'fa-utensils' },
  users: { label: 'کاربران', icon: 'fa-users' },
  departments: { label: 'واحدها', icon: 'fa-building' },
  finance: { label: 'مالی و حسابداری', icon: 'fa-coins' },
  announcements: { label: 'اطلاعیه', icon: 'fa-bullhorn' },
};

const MENU_GROUPS = [
  { title: 'عملیات روزانه', tabs: ['reports', 'weeks', 'orders', 'foods'] },
  { title: 'مهمان و رزرو', tabs: ['guests'] },
  { title: 'سازمان و مالی', tabs: ['users', 'departments', 'finance', 'announcements'] },
];

const SUPER_LINKS = [
  { path: '/admin/super/settings', label: 'تنظیمات', icon: 'fa-sliders', feature: 'superSettings' },
  { path: '/admin/super/security', label: 'امنیت و لاگ', icon: 'fa-shield-halved', feature: 'security' },
  { path: '/admin/super/backup', label: 'پشتیبان', icon: 'fa-database', feature: 'backup' },
];

const SUPER_PAGE_META = {
  '/admin/super/settings': {
    title: 'تنظیمات سامانه',
    sub: 'نام سازمان، ظاهر، LDAP و محدودیت‌های رزرو',
    icon: 'fa-sliders',
  },
  '/admin/super/security': {
    title: 'امنیت و لاگ',
    sub: 'WAF، ورود، قفل حساب و چرخه عمر سرور',
    icon: 'fa-shield-halved',
  },
  '/admin/super/backup': {
    title: 'پشتیبان‌گیری',
    sub: 'خروجی امن و بازگردانی داده‌ها',
    icon: 'fa-database',
  },
};

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [boot, setBoot] = useState(null);

  const activeTab = location.pathname.startsWith('/admin/super/')
    ? null
    : tabFromPathname(location.pathname);
  const superMeta = SUPER_PAGE_META[location.pathname];
  const isGuests = activeTab === 'guests';

  useEffect(() => {
    document.body.classList.add('admin-body');
    return () => document.body.classList.remove('admin-body');
  }, []);

  useEffect(() => {
    document.body.classList.toggle('admin-guests-tab', isGuests);
    return () => document.body.classList.remove('admin-guests-tab');
  }, [isGuests]);

  useEffect(() => {
    api('/api/app/admin/bootstrap').then((res) => {
      if (res.success) setBoot(res.data);
    });
  }, []);

  const adminCaps = useMemo(() => normalizeAdminCapabilities(boot?.capabilities, {
    isSuperadmin: boot?.isSuperadmin,
    role: boot?.currentUserRole,
    reportsAccess: boot?.reportsAccess,
  }), [boot]);

  const tabs = allowedAdminTabs(adminCaps);
  const isSuper = !!adminCaps.isSuperadmin;
  const superLinks = SUPER_LINKS.filter((l) => adminCaps.features?.[l.feature]);

  const pageTitle = superMeta?.title || (activeTab ? 'مدیریت هوشمند تغذیه' : '');
  const pageSub = superMeta?.sub || '';
  const pageIcon = superMeta?.icon || 'fa-cogs';
  const pageBadge = superMeta ? 'سوپر ادمین' : 'مدیریت سیستم';

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon"><i className="fas fa-chart-pie" /></div>
          <div>
            <span className="sidebar-brand-text">{boot?.appSettings?.organizationName || 'سامانه تغذیه'}</span>
            <span className="sidebar-brand-sub">پنل مدیریت</span>
          </div>
        </div>

        <ul className="sidebar-nav">
          {MENU_GROUPS.map((group) => {
            const items = group.tabs.filter((tab) => tabs.includes(tab));
            if (!items.length) return null;
            return (
              <li key={group.title} className="sidebar-group">
                <div className="sidebar-section-title">{group.title}</div>
                <ul className="sidebar-subnav">
                  {items.map((tab) => {
                    const meta = TAB_META[tab];
                    if (!meta) return null;
                    return (
                      <li key={tab}>
                        <a
                          href={adminTabPath(tab)}
                          className={`sidebar-link${activeTab === tab ? ' active' : ''}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(adminTabPath(tab));
                          }}
                        >
                          <i className={`fas ${meta.icon}`} /><span>{meta.label}</span>
                          {tab === 'reports' && !adminCaps.reportsAccess?.allowed && adminCaps.reportsAccess?.pendingCount > 0 && (
                            <span className="badge badge-warning sidebar-pending-badge">
                              {adminCaps.reportsAccess.pendingCount.toLocaleString('fa-IR')}
                            </span>
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>

        {isSuper && superLinks.length > 0 && (
          <div className="sidebar-super">
            <div className="sidebar-section-title">سوپر ادمین</div>
            <ul className="sidebar-super-nav">
              {superLinks.map((l) => (
                <li key={l.path}>
                  <NavLink
                    to={l.path}
                    className={({ isActive }) => `sidebar-link sidebar-link-super${isActive ? ' active' : ''}`}
                  >
                    <i className={`fas ${l.icon}`} /><span>{l.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="sidebar-footer">
          <div className="user-avatar">م</div>
          <div className="sidebar-footer-info">
            <span className="sidebar-user-name">{boot?.currentUserRole === 'superadmin' ? 'سوپر ادمین' : 'مدیر سیستم'}</span>
            <span className="sidebar-user-role">{isSuper ? 'دسترسی کامل' : 'مدیر'}</span>
            {boot?.appVersionMajorFa && (
              <span className="sidebar-app-version">
                نسخه {boot.appVersionMajorFa}
                {boot.appVersion && String(boot.appVersion) !== String(boot.appVersionMajor) && ` (${boot.appVersionFa})`}
              </span>
            )}
          </div>
        </div>
      </aside>

      <div className="main-content">
        <header className="top-header">
          <div className="date-chip">
            <i className="far fa-calendar-check" />
            <span>
              {new Date().toLocaleDateString('fa-IR-u-ca-persian', {
                timeZone: 'Asia/Tehran',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          <div className="header-actions">
            <Link to="/user/dashboard" className="btn-header btn-site"><i className="fas fa-eye" /> مشاهده پرتال</Link>
            <a
              href="/logout"
              className="btn-header btn-logout"
              onClick={(e) => { e.preventDefault(); window.location.assign('/logout'); }}
            >
              <i className="fas fa-sign-out-alt" /> خروج
            </a>
          </div>
        </header>
        <main className="content-wrapper">
          {pageTitle && !isGuests && (
            <div className="page-header">
              <div>
                <div className="ph-badge"><i className={`fas ${pageIcon}`} /> {pageBadge}</div>
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
