const Announcement = require('../models/Announcement');
const Department = require('../models/Department');
const User = require('../models/User');
const {
  encryptAnnouncementText,
  decryptAnnouncementText,
} = require('../helpers/AnnouncementCrypto');
const { formatJalaliDate, parseJalaliDate } = require('../helpers/DateHelper');

function endOfJalaliDay(value) {
  const parsed = parseJalaliDate(value);
  if (!parsed) return null;
  parsed.setHours(23, 59, 59, 999);
  return parsed;
}

function decryptAnnouncement(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    title: decryptAnnouncementText(doc.titleEnc),
    body: decryptAnnouncementText(doc.bodyEnc),
    audience: doc.audience,
    departmentIds: (doc.departmentIds || []).map((id) => String(id)),
    isActive: doc.isActive,
    expiresAt: doc.expiresAt || null,
    jalaliExpiresAt: doc.expiresAt ? formatJalaliDate(doc.expiresAt) : null,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function resolveUserDepartmentIds(user) {
  if (!user) return [];

  if (user.authSource === 'ldap') {
    const deptName = String(user.department || '').trim();
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
    const plain = decryptAnnouncement(row);
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
    .map(decryptAnnouncement)
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
    titleEnc: encryptAnnouncementText(String(title || '').trim()),
    bodyEnc: encryptAnnouncementText(String(body || '').trim()),
    audience: normalizedAudience,
    departmentIds: deptIds,
    isActive: isActive !== false,
    expiresAt: expiresAt || null,
    createdBy: createdBy || null,
  });

  return decryptAnnouncement(doc.toObject());
}

async function updateAnnouncement(id, { title, body, audience, departmentIds, isActive, expiresAt }) {
  const doc = await Announcement.findById(id);
  if (!doc) {
    const error = new Error('اطلاعیه یافت نشد');
    error.status = 404;
    throw error;
  }

  if (title !== undefined) {
    doc.titleEnc = encryptAnnouncementText(String(title).trim());
  }
  if (body !== undefined) {
    doc.bodyEnc = encryptAnnouncementText(String(body).trim());
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
  return decryptAnnouncement(doc.toObject());
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
