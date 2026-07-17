const User = require('../models/User');
const { comparePassword } = require('../helpers/SecurityHelper');
const { generateToken } = require('../helpers/TokenHelper');
const {
  assertActiveSession,
  commitAuthenticatedSession,
  invalidateSession,
} = require('../helpers/SessionSecurityHelper');
const { getSettingsLean, defaultSettings } = require('../services/SettingsService');
const { requestOrigin, buildAbsoluteUrl } = require('../helpers/AppUrlHelper');
const { issueSession } = require('../services/SessionTokenService');

async function getLoginViewModel(req, overrides = {}) {
  let settings = defaultSettings;
  try {
    settings = await getSettingsLean();
  } catch {
    settings = defaultSettings;
  }

  return {
    organizationName: settings?.organizationName || 'سامانه تغذیه',
    publicUrl: String(settings?.publicUrl || '').trim().replace(/\/$/, ''),
    clientBaseUrl: requestOrigin(req) || '',
    expired: false,
    idle: false,
    inactive: false,
    error: null,
    ...overrides,
  };
}

async function getActiveSessionRedirect(session) {
  if (!session?.token || session.authSource === 'ldap') {
    if (!session?.token) return null;
    const role = session.userRole || 'user';
    return ['admin', 'superadmin'].includes(role) ? '/admin/dashboard' : '/user/dashboard';
  }

  if (!session.userId) return null;
  const user = await User.findById(session.userId).select('status role').lean();
  if (!user || user.status !== 'active') return null;
  return ['admin', 'superadmin'].includes(user.role) ? '/admin/dashboard' : '/user/dashboard';
}

async function redirectTo(req, res, path) {
  const normalized = String(path || '/').startsWith('/') ? path : `/${path}`;
  if (process.env.FORCE_APP_URL === 'true') {
    const target = await buildAbsoluteUrl(req, normalized);
    return res.redirect(target);
  }
  return res.redirect(normalized);
}

class ViewController {
  static async renderLogin(req, res, next) {
    try {
      if (req.session?.token) {
        const sessionCheck = assertActiveSession(req);

        if (!sessionCheck.ok) {
          await invalidateSession(req, res, sessionCheck.reason);
          return res.render('auth/login', await getLoginViewModel(req, {
            expired: sessionCheck.reason !== 'idle',
            idle: sessionCheck.reason === 'idle',
            error: sessionCheck.message,
          }));
        }

        const redirectPath = await getActiveSessionRedirect(req.session);
        if (redirectPath) {
          return redirectTo(req, res, redirectPath);
        }

        await invalidateSession(req, res, 'expired');
        return res.render('auth/login', await getLoginViewModel(req, {
          inactive: true,
          error: 'حساب کاربری شما غیرفعال است',
        }));
      }

      const expired = req.query.expired === '1';
      const idle = req.query.idle === '1';
      const inactive = req.query.inactive === '1';

      const viewModel = await getLoginViewModel(req, { expired, idle, inactive });
      if (inactive && !viewModel.error) {
        viewModel.error = 'حساب کاربری شما غیرفعال است';
      }
      return res.render('auth/login', viewModel);
    } catch (error) {
      return next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const identifier = String(req.body.username || req.body.email || '').trim();
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const user = await User.findOne({
        $or: [
          { username: identifier },
          { email: identifier.toLowerCase() },
          { phone: identifier },
        ],
      }).select('+password');

      const loginView = async (status, error, extra = {}) => {
        const body = await getLoginViewModel(req, { error, ...extra });
        return res.status(status).render('auth/login', body);
      };

      if (user?.isLocked) {
        const min = Math.ceil((user.lockUntil - Date.now()) / 60000);
        return loginView(423, `حساب کاربری قفل شده است. ${min} دقیقه دیگر تلاش کنید.`);
      }

      if (!user || !(await comparePassword(password, user.password))) {
        if (user) {
          const attempts = (user.loginAttempts || 0) + 1;
          const update = { loginAttempts: attempts };
          if (attempts >= 5) update.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
          await User.findByIdAndUpdate(user._id, update);
        }
        return loginView(401, 'اطلاعات ورود صحیح نیست');
      }

      if (user && !['admin', 'superadmin'].includes(user.role)) {
        return loginView(401, 'ورود کاربران فقط از طریق Active Directory انجام می‌شود');
      }
      if (user.status !== 'active') {
        return loginView(403, 'حساب کاربری شما غیرفعال است', { inactive: true });
      }
      if (user.role === 'superadmin') {
        return loginView(403, 'ورود سوپر ادمین فقط از مسیر امن دو مرحله‌ای انجام می‌شود.');
      }

      const sessionId = await issueSession({
        userId: user._id,
        authSource: 'local',
        req,
      });

      const token = generateToken(user._id, user.email, user.role, user.username, sessionId);
      await commitAuthenticatedSession(req, {
        token,
        sessionId,
        userId: String(user._id),
        authSource: 'local',
        userRole: user.role,
        username: user.username,
        fullName: user.fullName,
      });

      return redirectTo(req, res, '/admin/dashboard');
    } catch (error) {
      return next(error);
    }
  }

  static async logout(req, res) {
    await invalidateSession(req, res, 'logout');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return redirectTo(req, res, '/login');
  }
}

module.exports = ViewController;
