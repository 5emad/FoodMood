const fs = require('fs');
const path = require('path');
const { encryptLogEntry, decryptLogEntry } = require('../helpers/LogCryptoHelper');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'system.log');
const STATS_FILE = path.join(LOG_DIR, 'lifecycle-stats.json');
const MAX_FILE_BYTES = Number(process.env.SYSTEM_LOG_MAX_BYTES || 5 * 1024 * 1024);
const DEFAULT_PER_PAGE = Number(process.env.SYSTEM_LOG_PER_PAGE || 30);
const MAX_PER_PAGE = 100;

const DEFAULT_STATS = {
  serverStarts: 0,
  serverStops: 0,
  dbConnects: 0,
  dbDisconnects: 0,
  dbReconnectAttempts: 0,
  lastServerStart: null,
  lastServerStop: null,
  lastDbConnect: null,
  lastDbDisconnect: null,
};

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o750 });
  }
}

function readLifecycleStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) return { ...DEFAULT_STATS };
    return { ...DEFAULT_STATS, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

function saveLifecycleStats(stats) {
  try {
    ensureLogDir();
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), { encoding: 'utf8', mode: 0o640 });
  } catch (err) {
    console.error('SystemLog stats save failed:', err.message);
  }
}

function listLogFiles() {
  ensureLogDir();
  const files = [];
  if (fs.existsSync(LOG_FILE)) files.push(LOG_FILE);
  try {
    const archived = fs.readdirSync(LOG_DIR)
      .filter((name) => /^system\.log\.\d{4}-\d{2}-\d{2}/.test(name))
      .sort()
      .map((name) => path.join(LOG_DIR, name));
    files.push(...archived);
  } catch {
    /* ignore */
  }
  return files.length ? files : [LOG_FILE];
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const size = fs.statSync(LOG_FILE).size;
    if (size < MAX_FILE_BYTES) return;
    const rotated = `${LOG_FILE}.${new Date().toISOString().slice(0, 10)}`;
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    fs.renameSync(LOG_FILE, rotated);
  } catch (err) {
    console.error('SystemLog rotate failed:', err.message);
  }
}

function parseLogLine(line) {
  const entry = decryptLogEntry(line);
  if (entry) return entry;
  return {
    ts: '',
    level: 'info',
    category: 'legacy',
    event: 'legacy',
    message: line,
    stack: '',
    detail: '',
  };
}

function readAllLogs() {
  try {
    const entries = [];
    for (const file of listLogFiles()) {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      content.trim().split('\n').filter(Boolean).forEach((line) => {
        entries.push(parseLogLine(line));
      });
    }
    return entries.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
  } catch (err) {
    console.error('SystemLog read failed:', err.message);
    return [];
  }
}

function writeSystemLog(level, category, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    category,
    event: meta.event || '',
    count: meta.count ?? null,
    message: String(message || '').slice(0, 2000),
    url: meta.url || '',
    method: meta.method || '',
    stack: meta.stack ? String(meta.stack).slice(0, 4000) : '',
    code: meta.code || '',
    detail: meta.detail ? String(meta.detail).slice(0, 500) : '',
  };

  let line;
  try {
    line = `${encryptLogEntry(entry)}\n`;
  } catch (encErr) {
    console.error('SystemLog encrypt failed:', encErr.message);
    line = `${JSON.stringify({ ...entry, encError: true })}\n`;
  }

  try {
    ensureLogDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line, { encoding: 'utf8', mode: 0o640 });
  } catch (err) {
    console.error('SystemLog write failed:', err.message);
  }

  const countSuffix = entry.count != null ? ` (#${entry.count})` : '';
  const journalLine = `[${entry.level}] [${entry.category}] ${entry.message}${countSuffix}`;
  if (level === 'error') console.error(journalLine);
  else if (level === 'warn') console.warn(journalLine);
  else console.log(journalLine);

  return entry;
}

function recordLifecycleEvent(event, message, meta = {}) {
  const stats = readLifecycleStats();
  const now = new Date().toISOString();

  switch (event) {
    case 'server_start':
      stats.serverStarts += 1;
      stats.lastServerStart = now;
      meta.count = stats.serverStarts;
      break;
    case 'server_stop':
      stats.serverStops += 1;
      stats.lastServerStop = now;
      meta.count = stats.serverStops;
      break;
    case 'db_connect':
      stats.dbConnects += 1;
      stats.lastDbConnect = now;
      meta.count = stats.dbConnects;
      break;
    case 'db_disconnect':
      stats.dbDisconnects += 1;
      stats.lastDbDisconnect = now;
      meta.count = stats.dbDisconnects;
      break;
    case 'db_reconnect_attempt':
      stats.dbReconnectAttempts += 1;
      meta.count = stats.dbReconnectAttempts;
      break;
    default:
      break;
  }

  saveLifecycleStats(stats);
  meta.event = event;
  return writeSystemLog(meta.level || 'info', meta.category || 'lifecycle', message, meta);
}

function readRecentLogs(limit = 200) {
  const max = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return readAllLogs().slice(0, max);
}

function readLogsPaginated({ page = 1, perPage = DEFAULT_PER_PAGE, level = '' } = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safePerPage = Math.min(Math.max(Number(perPage) || DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);
  let logs = readAllLogs();

  if (level && ['error', 'warn', 'info'].includes(level)) {
    logs = logs.filter((entry) => entry.level === level);
  }

  const total = logs.length;
  const totalPages = Math.max(Math.ceil(total / safePerPage), 1);
  const currentPage = Math.min(safePage, totalPages);
  const start = (currentPage - 1) * safePerPage;

  return {
    logs: logs.slice(start, start + safePerPage),
    pagination: {
      page: currentPage,
      perPage: safePerPage,
      total,
      totalPages,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
    },
  };
}

function clearAllLogs({ resetLifecycle = false } = {}) {
  ensureLogDir();
  for (const file of listLogFiles()) {
    try {
      if (fs.existsSync(file)) fs.writeFileSync(file, '', { encoding: 'utf8', mode: 0o640 });
    } catch (err) {
      console.error('SystemLog clear failed:', err.message);
    }
  }
  if (resetLifecycle) saveLifecycleStats({ ...DEFAULT_STATS });
}

module.exports = {
  LOG_DIR,
  LOG_FILE,
  STATS_FILE,
  DEFAULT_PER_PAGE,
  writeSystemLog,
  recordLifecycleEvent,
  readLifecycleStats,
  readRecentLogs,
  readLogsPaginated,
  ensureLogDir,
  clearAllLogs,
};
