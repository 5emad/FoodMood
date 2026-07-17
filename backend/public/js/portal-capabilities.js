(function (global) {
  'use strict';

  function isSuperadminReportUser(user) {
    return String(user?.role || '').toLowerCase() === 'superadmin'
      || String(user?.username || '').toLowerCase() === 'superadmin'
      || String(user?.fullName || '').toLowerCase() === 'superadmin';
  }

  function flagOn(value) {
    return !(value === false || value === 'false' || value === 0 || value === '0');
  }

  function normalizeUserCapabilities(raw) {
    const caps = raw || {};
    return {
      showPrices: flagOn(caps.showPrices) && flagOn(caps.showPricesToUsers),
      showStatement: flagOn(caps.showStatement) && flagOn(caps.showFinancialStatementToUsers),
      organizationSharePercent: Number(caps.organizationSharePercent || 0),
      personalSharePercent: Number(caps.personalSharePercent ?? (100 - Number(caps.organizationSharePercent || 0))),
      canReserve: caps.canReserve !== false,
      statementDisabledMessage: caps.statementDisabledMessage || 'در حال حاضر در دسترس نیست',
    };
  }

  function normalizeAdminCapabilities(raw, fallback) {
    const caps = raw || {};
    const fb = fallback || {};
    const tabs = caps.tabs || {};
    const defaultTabs = ['reports', 'weeks', 'orders', 'foods', 'users', 'departments', 'finance', 'guests', 'announcements'];
    const resolvedTabs = Object.keys(tabs).length
      ? tabs
      : defaultTabs.reduce((acc, tab) => { acc[tab] = true; return acc; }, {});
    return {
      role: caps.role || fb.role || '',
      isSuperadmin: Boolean(caps.isSuperadmin ?? fb.isSuperadmin),
      isAdmin: Boolean(caps.isAdmin ?? fb.isAdmin ?? true),
      reportsAccess: caps.reportsAccess || fb.reportsAccess || { allowed: true, pendingCount: 0, message: null },
      tabs: resolvedTabs,
      features: Object.assign({
        superSettings: Boolean(caps.isSuperadmin ?? fb.isSuperadmin),
        backup: Boolean(caps.isSuperadmin ?? fb.isSuperadmin),
        security: Boolean(caps.isSuperadmin ?? fb.isSuperadmin),
        financePdf: true,
        guestManagement: true,
      }, caps.features || {}),
    };
  }

  function allowedAdminTabs(caps) {
    return Object.entries(caps.tabs || {})
      .filter(([, allowed]) => allowed)
      .map(([name]) => name);
  }

  function applyAdminSidebarTabs(caps) {
    document.querySelectorAll('[data-admin-tab]').forEach((link) => {
      const tab = link.getAttribute('data-admin-tab');
      const allowed = Boolean(caps.tabs?.[tab]);
      link.closest('li')?.classList.toggle('nav-hidden', !allowed);
    });
    document.querySelectorAll('[data-super-feature]').forEach((link) => {
      const feature = link.getAttribute('data-super-feature');
      const allowed = Boolean(caps.features?.[feature]);
      link.closest('li')?.classList.toggle('nav-hidden', !allowed);
    });
  }

  function applyUserPortalTabs(caps) {
    const statementBtn = document.getElementById('statementTabBtn');
    const statementPanel = document.getElementById('tab-statement');
    if (statementBtn) statementBtn.hidden = !caps.showStatement;
    if (!caps.showStatement && statementPanel?.classList.contains('active')) {
      const menuBtn = document.querySelector('.tab-button[data-tab="menu"]');
      menuBtn?.click();
    }
  }

  global.PortalCapabilities = {
    isSuperadminReportUser,
    normalizeUserCapabilities,
    normalizeAdminCapabilities,
    allowedAdminTabs,
    applyAdminSidebarTabs,
    applyUserPortalTabs,
  };
}(window));
