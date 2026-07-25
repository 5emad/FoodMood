const roleMiddleware = (requiredRoles) => {
  const allowed = (requiredRoles || []).map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'احراز هویت الزامی است' });
    }

    const role = String(req.user.role || '').toLowerCase();
    if (!allowed.includes(role)) {
      if (req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/')) {
        return res.status(403).render('index', { user: req.user, error: 'دسترسی غیرمجاز' });
      }
      return res.status(403).json({
        success: false,
        message: 'دسترسی غیرمجاز',
        code: 'FORBIDDEN_ROLE',
        role,
      });
    }

    next();
  };
};

module.exports = roleMiddleware;
