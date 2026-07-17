export const ADMIN_TAB_NAMES = [
  'reports',
  'weeks',
  'orders',
  'foods',
  'users',
  'departments',
  'finance',
  'guests',
  'announcements',
];

export function isAdminTab(name) {
  return ADMIN_TAB_NAMES.includes(name);
}

export function adminTabPath(tab) {
  const name = isAdminTab(tab) ? tab : 'reports';
  return `/admin/${name}`;
}

export function tabFromPathname(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts[0] === 'admin' && isAdminTab(parts[1])) return parts[1];
  return 'reports';
}
