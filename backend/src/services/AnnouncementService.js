const Announcement = require('../models/Announcement');
const Department = require('../models/Department');
const User = require('../models/User');
const LdapProfile = require('../models/LdapProfile');
const { decryptAnnouncementText } = require('../helpers/AnnouncementCrypto');
const { formatJalaliDate, endOfJalaliDay } = require('../helpers/DateHelper');

function readAnnouncementContent(doc) {
  if (!doc) return { title: '', body: '' };
  const plainTitle = String(doc.title || '').trim();
  const plainBody = String(doc.body || '').trim();
  if (plainTitle || plainBody) {
    return { title: plainTitle, body: plainBody };
  }
  return {
    title: decryptAnnouncementText(doc.titleEnc || ''),
    body: decryptAnnouncementText(doc.bodyEnc || ''),
  };
}

function toAnnouncementDto(doc, extras = {}) {
  const content = readAnnouncementContent(doc);
  return {
    _id: String(doc._id),
    title: content.title,
    body: content.body,
    audience: doc.audience,
    departmentIds: (doc.departmentIds || []).map((id) => String(id)),
    isActive: doc.isActive,
    expiresAt: doc.expiresAt || null,
    jalaliExpiresAt: doc.expiresAt ? formatJalaliDate(doc.expiresAt) : null,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...extras,
  };
}

async function resolveUserDepartmentIds(user) {
  if (!user) return [];

  if (user.authSource === 'ldap') {
    const profile = await LdapProfile.findOne({ ldapUsername: String(user.username || '').toLowerCase() })
      .select('departmentId department')
      .lean();
    if (profile?.departmentId) return [profile.departmentId];
    const deptName = String(profile?.department || user.department || '').trim();
    if (!deptName) return [];
    const dept = await Department.findOne({ name: deptName }).select('_id').lean();
    return dept ? [dept._id] : [];
  }

  const dbUser = await User.findById(user.id).select('departmentId').lean();
  return dbUser?.departmentId ? [dbUser.departmentId] : [];
}

function buildActiveQuery(departmentIds) {
  const now = new Date();
  const audienceOr = [{ audience: 'all' }];
  if (departmentIds.length) {
    audienceOr.push({
      audience: 'department',
      departmentIds: { $in: departmentIds },
    });
  }

  return {
    isActive: true,
    $or: audienceOr,
    $and: [{
      $or: [
        { expiresAt: null },
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: now } },
      ],
    }],
  };
}

async function listForAdmin() {
  const rows = await Announcement.find()
    .sort({ createdAt: -1 })
    .populate('departmentIds', 'name')
    .populate('createdBy', 'fullName username')
    .lean();

  return rows.map((row) => {
    const plain = toAnnouncementDto(row);
    plain.departments = (row.departmentIds || []).map((d) => ({
      _id: String(d._id),
      name: d.name,
    }));
    plain.createdByUser = row.createdBy
      ? { fullName: row.createdBy.fullName, username: row.createdBy.username }
      : null;
    return plain;
  });
}

function isDisplayableAnnouncement(item) {
  if (!item || !item.isActive) return false;
  const title = String(item.title || '').trim();
  const body = String(item.body || '').trim();
  if (!title || !body) return false;
  if (item.expiresAt && new Date(item.expiresAt) <= new Date()) return false;
  return true;
}

async function listActiveForUser(user) {
  const departmentIds = await resolveUserDepartmentIds(user);
  const rows = await Announcement.find(buildActiveQuery(departmentIds))
    .sort({ createdAt: -1 })
    .lean();

  return rows
    .map((row) => toAnnouncementDto(row))
    .filter(isDisplayableAnnouncement)
    .map(({ isActive, ...item }) => item);
}

async function createAnnouncement({ title, body, audience, departmentIds, isActive, expiresAt, createdBy }) {
  const normalizedAudience = audience === 'department' ? 'department' : 'all';
  const deptIds = normalizedAudience === 'department'
    ? (departmentIds || []).filter(Boolean)
    : [];

  if (normalizedAudience === 'department' && !deptIds.length) {
    const error = new Error('حداقل یک واحد برای اطلاعیه هدف‌دار انتخاب کنید');
    error.status = 400;
    throw error;
  }

  const doc = await Announcement.create({
    title: String(title || '').trim(),
    body: String(body || '').trim(),
    titleEnc: '',
    bodyEnc: '',
    audience: normalizedAudience,
    departmentIds: deptIds,
    isActive: isActive !== false,
    expiresAt: expiresAt || null,
    createdBy: createdBy || null,
  });

  return toAnnouncementDto(doc.toObject());
}

async function updateAnnouncement(id, { title, body, audience, departmentIds, isActive, expiresAt }) {
  const doc = await Announcement.findById(id);
  if (!doc) {
    const error = new Error('اطلاعیه یافت نشد');
    error.status = 404;
    throw error;
  }

  if (title !== undefined) {
    doc.title = String(title).trim();
    doc.titleEnc = '';
  }
  if (body !== undefined) {
    doc.body = String(body).trim();
    doc.bodyEnc = '';
  }
  if (audience !== undefined) {
    doc.audience = audience === 'department' ? 'department' : 'all';
  }
  if (departmentIds !== undefined) {
    doc.departmentIds = doc.audience === 'department'
      ? departmentIds.filter(Boolean)
      : [];
  }
  if (doc.audience === 'department' && !doc.departmentIds.length) {
    const error = new Error('حداقل یک واحد برای اطلاعیه هدف‌دار انتخاب کنید');
    error.status = 400;
    throw error;
  }
  if (isActive !== undefined) doc.isActive = !!isActive;
  if (expiresAt !== undefined) doc.expiresAt = expiresAt || null;

  await doc.save();
  return toAnnouncementDto(doc.toObject());
}

async function deleteAnnouncement(id) {
  const doc = await Announcement.findByIdAndDelete(id);
  if (!doc) {
    const error = new Error('اطلاعیه یافت نشد');
    error.status = 404;
    throw error;
  }
  return true;
}

module.exports = {
  listForAdmin,
  listActiveForUser,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  endOfJalaliDay,
};
