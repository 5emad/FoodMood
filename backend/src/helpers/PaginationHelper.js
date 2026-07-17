function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function paginationFromQuery(query, defaults = {}) {
  const defaultLimit = defaults.limit || 20;
  const maxLimit = defaults.maxLimit || 100;
  const page = clampNumber(query.page, 1, 1, 100000);
  const limit = clampNumber(query.limit, defaultLimit, 1, maxLimit);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function paginationMeta({ page, limit, total }) {
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  return {
    page,
    limit,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

module.exports = {
  paginationFromQuery,
  paginationMeta,
};
