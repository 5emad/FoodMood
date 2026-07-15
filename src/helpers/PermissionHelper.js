const { getReportsAccessForUser } = require('./ReportsAccessHelper');
const { getSettingsLean } = require('../services/SettingsService');

const ADMIN_TABS = ['reports', 'weeks', 'orders', 'foods', 'users', 'departments', 'finance', 'guests', 'announcements'];
const STATEMENT_DISABLED_MESSAGE = 'در حال حاضر در دسترس نیست';

function isSuperadmin(user = {}) {
  return String(user.role || '').toLowerCase() === 'superadmin';
}

function isAdminPortalUser(user = {}) {
  const role = String(user.role || '').toLowerCase();
  return role === 'admin' || role === 'superadmin';
}

function isSuperadminReportUser(user = {}) {
  return isSuperadmin(user) || String(user.username || '').toLowerCase() === 'superadmin';
}

function canAccessTab(user, tabName) {
  if (!isAdminPortalUser(user)) return false;
  return ADMIN_TABS.includes(tabName);
}

async function getAdminCapabilities(user) {
  const reportsAccess = await getReportsAccessForUser(user);
  const superadmin = isSuperadmin(user);
  return {
    role: user?.role || '',
    isSuperadmin: superadmin,
    isAdmin: isAdminPortalUser(user),
    reportsAccess,
    tabs: ADMIN_TABS.reduce((acc, tab) => {
      acc[tab] = canAccessTab(user, tab);
      return acc;
    }, {}),
    features: {
      superSettings: superadmin,
      backup: superadmin,
      security: superadmin,
      financePdf: isAdminPortalUser(user),
      guestManagement: isAdminPortalUser(user),
    },
  };
}

async function getUserCapabilities() {
  const settings = await getSettingsLean();
  const organizationSharePercent = Math.min(100, Math.max(0, Number(settings.organizationSharePercent) || 0));
  return {
    showPrices: settings.showPricesToUsers !== false,
    showStatement: settings.showFinancialStatementToUsers !== false,
    organizationSharePercent,
    personalSharePercent: 100 - organizationSharePercent,
    canReserve: true,
    statementDisabledMessage: STATEMENT_DISABLED_MESSAGE,
  };
}

async function resolveShowPricesForRequest(req) {
  if (isAdminPortalUser(req?.user)) return true;
  const caps = await getUserCapabilities();
  return caps.showPrices;
}

function capabilitiesApiShape(capabilities) {
  return {
    showPrices: capabilities.showPrices,
    showStatement: capabilities.showStatement,
    showPricesToUsers: capabilities.showPrices,
    showFinancialStatementToUsers: capabilities.showStatement,
    organizationSharePercent: capabilities.organizationSharePercent,
    personalSharePercent: capabilities.personalSharePercent,
    canReserve: capabilities.canReserve,
    statementDisabledMessage: capabilities.statementDisabledMessage,
  };
}

function statementDisabledPayload(capabilities) {
  return {
    success: true,
    disabled: true,
    message: capabilities?.statementDisabledMessage || STATEMENT_DISABLED_MESSAGE,
  };
}

function stripPricesFromMenuPayload(data, showPrices) {
  if (showPrices || !data) return data;
  const clone = JSON.parse(JSON.stringify(data));
  if (clone.settings) clone.settings.showPricesToUsers = false;
  if (Array.isArray(clone.days)) {
    clone.days = clone.days.map((day) => ({
      ...day,
      items: (day.items || []).map((item) => {
        const next = { ...item };
        delete next.price;
        delete next.customPrice;
        if (next.foodId) {
          next.foodId = { ...next.foodId };
          delete next.foodId.price;
        }
        return next;
      }),
    }));
  }
  return clone;
}

function stripPricesFromFood(food, showPrices) {
  if (showPrices || !food) return food;
  const plain = food.toObject ? food.toObject() : { ...food };
  delete plain.price;
  return plain;
}

function stripPricesFromFoodList(foods, showPrices) {
  if (showPrices || !foods) return foods;
  return foods.map((food) => stripPricesFromFood(food, false));
}

function stripPricesFromOrder(order, showPrices) {
  if (showPrices || !order) return order;
  const plain = order.toObject ? order.toObject() : { ...order };
  delete plain.totalPrice;
  if (Array.isArray(plain.items)) {
    plain.items = plain.items.map((item) => {
      const next = { ...item };
      delete next.price;
      if (next.foodId && typeof next.foodId === 'object') {
        next.foodId = { ...next.foodId };
        delete next.foodId.price;
      }
      return next;
    });
  }
  return plain;
}

module.exports = {
  ADMIN_TABS,
  STATEMENT_DISABLED_MESSAGE,
  isSuperadmin,
  isAdminPortalUser,
  isSuperadminReportUser,
  canAccessTab,
  getAdminCapabilities,
  getUserCapabilities,
  resolveShowPricesForRequest,
  capabilitiesApiShape,
  statementDisabledPayload,
  stripPricesFromMenuPayload,
  stripPricesFromFood,
  stripPricesFromFoodList,
  stripPricesFromOrder,
};
