export function flagOn(value) {
  return !(value === false || value === 'false' || value === 0 || value === '0');
}

export function normalizeUserCapabilities(raw) {
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

export function normalizeAdminCapabilities(raw, fallback = {}) {
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
    features: {
      superSettings: Boolean(caps.isSuperadmin ?? fb.isSuperadmin),
      backup: Boolean(caps.isSuperadmin ?? fb.isSuperadmin),
      security: Boolean(caps.isSuperadmin ?? fb.isSuperadmin),
      financePdf: true,
      guestManagement: true,
      ...(caps.features || {}),
    },
  };
}

export function allowedAdminTabs(caps) {
  return Object.entries(caps.tabs || {})
    .filter(([, allowed]) => allowed)
    .map(([name]) => name);
}
