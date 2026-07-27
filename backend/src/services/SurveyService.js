const Survey = require('../models/Survey');
const Week = require('../models/Week');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const Food = require('../models/Food');
const { isLdapAuth } = require('../helpers/AuthUserHelper');
const { formatJalaliDate, startOfDay } = require('../helpers/DateHelper');

const CONFIG_QUERY = { kind: 'config' };

const DEFAULT_STATEMENTS = [
  { text: 'طعم غذا خوب بود', sentiment: 'positive' },
  { text: 'کیفیت پخت مناسب بود', sentiment: 'positive' },
  { text: 'مقدار غذا کافی بود', sentiment: 'positive' },
  { text: 'غذا به‌موقع سرو شد', sentiment: 'positive' },
  { text: 'غذا نچته بود', sentiment: 'negative' },
  { text: 'غذا سرد بود', sentiment: 'negative' },
  { text: 'مقدار غذا کم بود', sentiment: 'negative' },
  { text: 'طعم غذا مطلوب نبود', sentiment: 'negative' },
];

function userKeyOf(user = {}) {
  if (isLdapAuth(user)) return `ldap:${user.username}`;
  return String(user.id || user._id || '');
}

function withStatementIds(list = []) {
  return list.map((item) => ({
    id: item.id || Survey.newStatementId(),
    text: String(item.text || '').trim().slice(0, 200),
    sentiment: item.sentiment === 'negative' ? 'negative' : 'positive',
  })).filter((item) => item.text);
}

function defaultStatements() {
  return withStatementIds(DEFAULT_STATEMENTS);
}

async function ensureConfig() {
  let config = await Survey.findOne(CONFIG_QUERY);
  if (config) {
    if (!Array.isArray(config.statements) || !config.statements.length) {
      config.statements = defaultStatements();
      await config.save();
    }
    return config;
  }
  config = await Survey.create({
    kind: 'config',
    isActive: false,
    activationId: '',
    statements: defaultStatements(),
  });
  return config;
}

function serializeConfig(config) {
  return {
    isActive: !!config.isActive,
    activationId: config.activationId || '',
    statements: (config.statements || []).map((s) => ({
      id: s.id,
      text: s.text,
      sentiment: s.sentiment,
    })),
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy || '',
  };
}

async function getConfig() {
  const config = await ensureConfig();
  return serializeConfig(config);
}

async function updateStatements(statements, updatedBy = '') {
  const config = await ensureConfig();
  const next = withStatementIds(statements);
  if (!next.length) {
    const error = new Error('حداقل یک جمله برای نظرسنجی لازم است');
    error.status = 400;
    throw error;
  }
  config.statements = next;
  config.updatedBy = String(updatedBy || '').slice(0, 120);
  await config.save();
  return serializeConfig(config);
}

async function setActive(isActive, updatedBy = '') {
  const config = await ensureConfig();
  const nextActive = !!isActive;
  if (nextActive && !config.isActive) {
    config.activationId = Survey.newActivationId();
  }
  if (!nextActive) {
    // keep activationId for historical responses; just turn off
  }
  config.isActive = nextActive;
  if (nextActive && !config.activationId) {
    config.activationId = Survey.newActivationId();
  }
  config.updatedBy = String(updatedBy || '').slice(0, 120);
  await config.save();
  return serializeConfig(config);
}

async function listCandidateFoods() {
  const weeks = await Week.find({ $or: [{ isActive: true }, { status: 'active' }] })
    .select('_id')
    .lean();
  if (weeks.length) {
    const menus = await DailyMenu.find({ weekId: { $in: weeks.map((w) => w._id) } })
      .select('_id')
      .lean();
    if (menus.length) {
      const items = await MenuItem.find({ dailyMenuId: { $in: menus.map((m) => m._id) } })
        .populate('foodId', 'name status isAvailable')
        .lean();
      const map = new Map();
      for (const item of items) {
        const food = item.foodId;
        if (!food?._id) continue;
        if (food.status && food.status !== 'active') continue;
        map.set(String(food._id), { _id: String(food._id), name: food.name || 'غذا' });
      }
      if (map.size) return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    }
  }

  const foods = await Food.find({
    status: 'active',
    isAvailable: { $ne: false },
  }).select('name').sort({ name: 1 }).lean();

  return foods.map((f) => ({ _id: String(f._id), name: f.name || 'غذا' }));
}

async function getActiveForUser(user) {
  const config = await ensureConfig();
  if (!config.isActive || !config.activationId) return null;

  const userKey = userKeyOf(user);
  if (!userKey) return null;

  const existing = await Survey.findOne({
    kind: 'response',
    userKey,
    activationId: config.activationId,
  }).lean();
  if (existing) return null;

  const foods = await listCandidateFoods();
  return {
    activationId: config.activationId,
    statements: serializeConfig(config).statements,
    foods,
  };
}

async function respond({
  user,
  activationId,
  bestFoodId = '',
  selectedStatementIds = [],
  skipped = false,
}) {
  const config = await ensureConfig();
  if (!config.isActive || !config.activationId) {
    const error = new Error('نظرسنجی فعالی وجود ندارد');
    error.status = 400;
    throw error;
  }
  if (String(activationId || '') !== String(config.activationId)) {
    const error = new Error('این نظرسنجی منقضی شده است');
    error.status = 409;
    throw error;
  }

  const userKey = userKeyOf(user);
  if (!userKey) {
    const error = new Error('کاربر نامعتبر است');
    error.status = 401;
    throw error;
  }

  const existing = await Survey.findOne({
    kind: 'response',
    userKey,
    activationId: config.activationId,
  }).lean();
  if (existing) {
    return { alreadyResponded: true };
  }

  let bestFoodName = '';
  let resolvedFoodId = '';
  if (!skipped && bestFoodId) {
    const foods = await listCandidateFoods();
    const found = foods.find((f) => String(f._id) === String(bestFoodId));
    if (found) {
      resolvedFoodId = found._id;
      bestFoodName = found.name;
    }
  }

  const allowedIds = new Set((config.statements || []).map((s) => s.id));
  const selected = (Array.isArray(selectedStatementIds) ? selectedStatementIds : [])
    .map(String)
    .filter((id) => allowedIds.has(id));

  await Survey.create({
    kind: 'response',
    activationId: config.activationId,
    userKey,
    bestFoodId: resolvedFoodId,
    bestFoodName,
    selectedStatementIds: skipped ? [] : selected,
    skipped: !!skipped,
  });

  return { success: true, skipped: !!skipped };
}

function dayKey(date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

async function getResults({ days = 14 } = {}) {
  const config = await ensureConfig();
  const statementMap = new Map((config.statements || []).map((s) => [s.id, s]));

  const responses = await Survey.find({ kind: 'response', skipped: false })
    .sort({ createdAt: 1 })
    .lean();

  const foodVotes = new Map();
  let positivePicks = 0;
  let negativePicks = 0;
  const byDay = new Map();

  for (const row of responses) {
    if (row.bestFoodId || row.bestFoodName) {
      const key = row.bestFoodId || row.bestFoodName;
      const prev = foodVotes.get(key) || {
        foodId: row.bestFoodId || '',
        foodName: row.bestFoodName || 'غذا',
        votes: 0,
      };
      prev.votes += 1;
      if (row.bestFoodName) prev.foodName = row.bestFoodName;
      foodVotes.set(key, prev);
    }

    let dayPos = 0;
    let dayNeg = 0;
    for (const sid of row.selectedStatementIds || []) {
      const st = statementMap.get(sid);
      if (!st) continue;
      if (st.sentiment === 'positive') {
        positivePicks += 1;
        dayPos += 1;
      } else {
        negativePicks += 1;
        dayNeg += 1;
      }
    }

    const key = dayKey(row.createdAt || new Date());
    const day = byDay.get(key) || { date: key, positive: 0, negative: 0, responses: 0 };
    day.positive += dayPos;
    day.negative += dayNeg;
    day.responses += 1;
    byDay.set(key, day);
  }

  const totalVotes = [...foodVotes.values()].reduce((sum, f) => sum + f.votes, 0);
  const foods = [...foodVotes.values()]
    .map((f) => ({
      ...f,
      percent: totalVotes ? Math.round((f.votes * 1000) / totalVotes) / 10 : 0,
    }))
    .sort((a, b) => b.votes - a.votes);

  const statementTotal = positivePicks + negativePicks;
  const satisfactionPercent = statementTotal
    ? Math.round((positivePicks * 1000) / statementTotal) / 10
    : 0;

  const dayCount = Math.max(7, Math.min(30, Number(days) || 14));
  const today = startOfDay(new Date());
  const momentum = [];
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const row = byDay.get(key) || { positive: 0, negative: 0, responses: 0 };
    const total = row.positive + row.negative;
    momentum.push({
      date: key,
      jalaliDate: formatJalaliDate(d),
      responses: row.responses,
      positive: row.positive,
      negative: row.negative,
      satisfactionPercent: total ? Math.round((row.positive * 1000) / total) / 10 : null,
    });
  }

  const skippedCount = await Survey.countDocuments({ kind: 'response', skipped: true });
  const submittedCount = responses.length;

  return {
    config: serializeConfig(config),
    summary: {
      submittedCount,
      skippedCount,
      totalResponses: submittedCount + skippedCount,
      satisfactionPercent,
      positivePicks,
      negativePicks,
      foodVoteCount: totalVotes,
    },
    foods,
    momentum,
  };
}

module.exports = {
  getConfig,
  updateStatements,
  setActive,
  getActiveForUser,
  respond,
  getResults,
  listCandidateFoods,
  DEFAULT_STATEMENTS,
};
