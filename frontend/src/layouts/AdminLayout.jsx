import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { allowedAdminTabs } from '../lib/portalCapabilities';

const TAB_LINKS = [
  { tab: 'reports', label: 'گزارش‌ها', icon: 'fa-chart-line' },
  { tab: 'weeks', label: 'هفته‌ها', icon: 'fa-calendar-week' },
  { tab: 'orders', label: 'سفارش‌ها', icon: 'fa-clipboard-list' },
  { tab: 'guests', label: 'مهمان‌ها', icon: 'fa-user-tag' },
  { tab: 'foods', label: 'غذاها', icon: 'fa-utensils' },
  { tab: 'users', label: 'کاربران', icon: 'fa-users' },
  { tab: 'departments', label: 'واحدها', icon: 'fa-building' },
  { tab: 'finance', label: 'مالی و حسابداری', icon: 'fa-coins' },
  { tab: 'announcements', label: 'اطلاعیه', icon: 'fa-bullhorn' },
];

const SUPER_LINKS = [
  { path: '/admin/super/settings', label: 'تنظیمات سامانه', icon: 'fa-sliders', feature: 'superSettings' },
  { path: '/admin/super/security', label: 'امنیت و لاگ', icon: 'fa-shield-halved', feature: 'security' },
  { path: '/admin/super/backup', label: 'پشتیبان‌گیری', icon: 'fa-database', feature: 'backup' },
];

export default function AdminLayout({ children, activeTab, pageTitle, pageSub }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [boot, setBoot] = useState(null);

  useEffect(() => {
    api('/api/app/admin/bootstrap').then((res) => {
      if (res.success) setBoot(res.data);
    });
  }, []);

  const caps = boot?.capabilities || {};
  const tabs = allowedAdminTabs({ tabs: caps.tabs || {} });
  const isSuper = !!boot?.isSuperadmin;

  function goTab(tab) {
    navigate(`/admin/dashboard?tab=${tab}`);
  }

  return (
    <div className="admin-body" style={{ display: 'flex', minHeight: '100vh' }}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon"><i className="fas fa-chart-pie" /></div>
          <div>
            <span className="sidebar-brand-text" id="sidebarOrgName">{boot?.appSettings?.organizationName || 'سامانه تغذیه'}</span>
            <span className="sidebar-brand-sub">پنل مدیریت</span>
          </div>
        </div>
        <ul className="sidebar-nav">
          <li><div className="sidebar-section-title">مدیریت</div></li>
          {TAB_LINKS.filter((l) => tabs.includes(l.tab)).map((l) => (
            <li key={l.tab}>
              <a
                href={`/admin/dashboard?tab=${l.tab}`}
                className={`sidebar-link${activeTab === l.tab ? ' active' : ''}`}
                onClick={(e) => { e.preventDefault(); goTab(l.tab); }}
              >
                <i className={`fas ${l.icon}`} /><span>{l.label}</span>
              </a>
            </li>
          ))}
          {isSuper && (
            <>
              <li><div className="sidebar-section-title">سوپر ادمین</div></li>
              {SUPER_LINKS.map((l) => (
                <li key={l.path}>
                  <Link to={l.path} className={`sidebar-link${location.pathname === l.path ? ' active' : ''}`}>
                    <i className={`fas ${l.icon}`} /><span>{l.label}</span>
                  </Link>
                </li>
              ))}
            </>
          )}
        </ul>
        <div className="sidebar-footer">
          <div className="user-avatar">م</div>
          <div className="sidebar-footer-info">
            <span className="sidebar-user-name">{boot?.currentUserRole === 'superadmin' ? 'سوپر ادمین' : 'مدیر سیستم'}</span>
            <span className="sidebar-user-role">{isSuper ? 'سوپر ادمین' : 'مدیر'}</span>
          </div>
        </div>
      </aside>

      <div className="main-content">
        <header className="top-header">
          <div className="date-chip"><i className="far fa-calendar-check" /><span id="todayDate">{new Date().toLocaleDateString('fa-IR-u-ca-persian', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span></div>
          <div className="header-actions">
            <Link to="/user/dashboard" className="btn-header btn-site"><i className="fas fa-eye" /> مشاهده پرتال</Link>
            <a href="/logout" className="btn-header btn-logout"><i className="fas fa-sign-out-alt" /> خروج</a>
          </div>
        </header>
        <main className="content-wrapper">
          {pageTitle && (
            <div className="page-header">
              <div>
                <div className="ph-badge"><i className="fas fa-cogs" /> مدیریت سیستم</div>
                <div className="ph-title">{pageTitle}</div>
                {pageSub && <div className="ph-sub">{pageSub}</div>}
              </div>
              <i className="fas fa-cogs ph-icon" />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
