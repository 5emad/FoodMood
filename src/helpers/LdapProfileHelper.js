const LdapProfile = require('../models/LdapProfile');

const PERSIAN_NAME_PATTERN = /^[\u0600-\u06FF\s\u200c]{3,80}$/;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function isValidPersianFullName(fullName) {
  const value = String(fullName || '').trim();
  return PERSIAN_NAME_PATTERN.test(value) && value.split(/\s+/).filter(Boolean).length >= 2;
}

async function findProfile(username) {
  const ldapUsername = normalizeUsername(username);
  if (!ldapUsername) return null;
  return LdapProfile.findOne({ ldapUsername }).lean();
}

async function needsProfileSetup(username) {
  const profile = await findProfile(username);
  return !profile || !isValidPersianFullName(profile.fullName);
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
    department: department ? String(department).trim() : null,
  };

  return LdapProfile.findOneAndUpdate(
    { ldapUsername },
    { $set: update, $setOnInsert: { ldapUsername } },
    { upsert: true, new: true, lean: true },
  );
}

async function resolveDisplayName(username, fallback = '') {
  const profile = await findProfile(username);
  if (profile?.fullName && isValidPersianFullName(profile.fullName)) {
    return profile.fullName;
  }
  return String(fallback || username || '').trim();
}

module.exports = {
  PERSIAN_NAME_PATTERN,
  isValidPersianFullName,
  findProfile,
  needsProfileSetup,
  saveFullName,
  resolveDisplayName,
};
