const roleMiddleware = (requiredRoles) => {
  const allowed = (requiredRoles || []).map((r) => String(r).toLowerCase().trim());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'احراز هویت الزامی است' });
    }

    let role = String(req.user.role || '').toLowerCase().trim();
    // Common aliases / legacy values
    if (role === 'super_admin' || role === 'super-admin') role = 'superadmin';
    if (role === 'administrator') role = 'admin';

    if (!allowed.includes(role)) {
      const need = allowed.join(' یا ');
      const msg = `دسترسی غیرمجاز (نقش فعلی: ${role || 'نامشخص'}؛ نیاز به: ${need})`;
      if (req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/')) {
        return res.status(403).render('index', { user: req.user, error: msg });
      }
      return res.status(403).json({
        success: false,
        message: msg,
        code: 'FORBIDDEN_ROLE',
        role,
        required: allowed,
      });
    }

    req.user.role = role;
    next();
  };
};

module.exports = roleMiddleware;
