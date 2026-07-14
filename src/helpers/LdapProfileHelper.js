const LdapProfile = require('../models/LdapProfile');
const Department = require('../models/Department');

const PERSIAN_NAME_PATTERN = /^[\u0600-\u06FF\s\u200c]{3,80}$/;
const LDAP_USER_ID_RE = /^ldap:([a-z0-9._-]+)$/i;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function parseLdapUserId(id) {
  const match = String(id || '').match(LDAP_USER_ID_RE);
  return match ? normalizeUsername(match[1]) : null;
}

function isValidPersianFullName(fullName) {
  const value = String(fullName || '').trim();
  return PERSIAN_NAME_PATTERN.test(value) && value.split(/\s+/).filter(Boolean).length >= 2;
}

async function findProfile(username) {
  const ldapUsername = normalizeUsername(username);
  if (!ldapUsername) return null;
  return LdapProfile.findOne({ ldapUsername }).populate('departmentId', 'name').lean();
}

async function needsProfileSetup(username) {
  const profile = await findProfile(username);
  return !profile || !isValidPersianFullName(profile.fullName);
}

async function isProfileActive(username) {
  const profile = await findProfile(username);
  return !profile || profile.status !== 'inactive';
}

async function saveFullName(username, fullName, department = null) {
  const ldapUsername = normalizeUsername(username);
  const name = String(fullName || '').trim();
  if (!ldapUsername || !isValidPersianFullName(name)) {
    const error = new Error('لطفا نام و نام خانوادگی خود را به فارسی وارد کنید');
    error.status = 400;
    throw error;
  }

  const update = {
    fullName: name,
    status: 'active',
  };
  if (department) update.department = String(department).trim();

  return LdapProfile.findOneAndUpdate(
    { ldapUsername },
    { $set: update, $setOnInsert: { ldapUsername } },
    { upsert: true, new: true, lean: true },
  );
}

async function updateProfileAdmin(ldapUsername, fields = {}) {
  const username = normalizeUsername(ldapUsername);
  const profile = await LdapProfile.findOne({ ldapUsername: username });
  if (!profile) {
    const error = new Error('کاربر یافت نشد');
    error.status = 404;
    throw error;
  }

  if (fields.fullName !== undefined) {
    const name = String(fields.fullName || '').trim();
    if (!isValidPersianFullName(name)) {
      const error = new Error('نام کامل باید فارسی و شامل نام و نام خانوادگی باشد');
      error.status = 400;
      throw error;
    }
    profile.fullName = name;
  }
  if (fields.email !== undefined) {
    profile.email = fields.email ? String(fields.email).trim().toLowerCase() : null;
  }
  if (fields.phone !== undefined) {
    profile.phone = fields.phone ? String(fields.phone).trim() : null;
  }
  if (fields.status !== undefined) {
    profile.status = fields.status === 'inactive' ? 'inactive' : 'active';
  }
  if (fields.role !== undefined) {
    profile.role = fields.role === 'admin' ? 'admin' : 'user';
  }
  if (fields.departmentId !== undefined) {
    profile.departmentId = fields.departmentId || null;
    if (!fields.departmentId) {
      profile.department = null;
    } else {
      const dept = await Department.findById(fields.departmentId).select('name').lean();
      profile.department = dept?.name || null;
    }
  }

  await profile.save();
  return profile.toObject();
}

async function deleteProfile(ldapUsername) {
  const username = normalizeUsername(ldapUsername);
  const profile = await LdapProfile.findOneAndDelete({ ldapUsername: username });
  if (!profile) {
    const error = new Error('کاربر یافت نشد');
    error.status = 404;
    throw error;
  }
  return true;
}

async function resolveDisplayName(username, fallback = '') {
  const profile = await findProfile(username);
  if (profile?.fullName && isValidPersianFullName(profile.fullName)) {
    return profile.fullName;
  }
  return String(fallback || username || '').trim();
}

async function resolveLdapRole(username) {
  const profile = await findProfile(username);
  return profile?.role === 'admin' ? 'admin' : 'user';
}

async function enrichLdapSessionUser(user = {}) {
  const profile = await findProfile(user.username);
  if (!profile) return user;
  return {
    ...user,
    role: profile.role === 'admin' ? 'admin' : (user.role || 'user'),
    fullName: isValidPersianFullName(profile.fullName) ? profile.fullName : user.fullName,
    email: profile.email || user.email || null,
    phone: profile.phone || null,
    department: profile.departmentId?.name || profile.department || user.department || null,
    ldapProfileStatus: profile.status,
  };
}

module.exports = {
  PERSIAN_NAME_PATTERN,
  isValidPersianFullName,
  parseLdapUserId,
  findProfile,
  needsProfileSetup,
  isProfileActive,
  saveFullName,
  updateProfileAdmin,
  deleteProfile,
  resolveDisplayName,
  resolveLdapRole,
  enrichLdapSessionUser,
};
