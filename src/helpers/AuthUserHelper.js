const User = require('../models/User');

function isLdapAuth(user = {}) {
  return user.authSource === 'ldap' || String(user.id || '').startsWith('ldap:');
}

function orderOwnerFilter(user = {}) {
  if (isLdapAuth(user)) {
    return { ldapUsername: user.username };
  }
  return { userId: user.id };
}

async function buildOrderOwnerFilter(user = {}) {
  if (!isLdapAuth(user)) {
    return { userId: user.id };
  }

  const clauses = [{ ldapUsername: user.username }];
  const legacyUser = await User.findOne({ username: user.username }).select('_id').lean();
  if (legacyUser?._id) {
    clauses.push({ userId: legacyUser._id });
  }
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function orderBelongsToUser(order, user = {}) {
  if (!order) return false;
  if (order.ldapUsername && user.username && String(order.ldapUsername) === String(user.username)) {
    return true;
  }
  if (isLdapAuth(user)) {
    return false;
  }
  const orderUserId = order.userId?._id || order.userId;
  return orderUserId && String(orderUserId) === String(user.id);
}

function orderActorFromRequest(req) {
  const user = req.user || {};
  if (isLdapAuth(user)) {
    return {
      userId: null,
      ldapUsername: user.username,
      orderUserName: user.fullName || user.username,
      orderUserDepartment: user.department || null,
    };
  }
  return { userId: user.id };
}

function orderUserDisplay(order = {}) {
  if (order.ldapUsername) {
    return {
      username: order.ldapUsername,
      fullName: order.orderUserName || order.ldapUsername,
      department: order.orderUserDepartment || 'بدون واحد',
      role: 'user',
      authSource: 'ldap',
    };
  }
  const user = order.userId || {};
  return {
    username: user.username,
    fullName: user.fullName || user.username || '-',
    department: user.departmentId?.name || 'بدون واحد',
    role: user.role,
    authSource: 'local',
  };
}

module.exports = {
  isLdapAuth,
  orderOwnerFilter,
  buildOrderOwnerFilter,
  orderBelongsToUser,
  orderActorFromRequest,
  orderUserDisplay,
};
