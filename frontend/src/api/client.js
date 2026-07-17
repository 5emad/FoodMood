let csrfPromise = null;

export function resetCsrf() {
  csrfPromise = null;
}

async function getCsrfToken() {
  if (!csrfPromise) {
    csrfPromise = fetch('/api/auth/csrf', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.csrfToken ? d.csrfToken : ''))
      .catch(() => '');
  }
  return csrfPromise;
}

function redirectLogin(reason) {
  if (window.location.pathname.includes('/login')) return;
  const q = reason === 'idle' ? 'idle=1' : 'expired=1';
  window.location.replace(`/login?${q}`);
}

export async function api(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  if (needsCsrf) {
    const token = await getCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers,
  });

  if (res.status === 403 && needsCsrf) resetCsrf();
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => null);
    redirectLogin(body?.code === 'idle' ? 'idle' : 'expired');
    throw new Error('401');
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, message: text || `HTTP ${res.status}` };
  }
}

export async function apiBlob(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const headers = { ...(options.headers || {}) };
  if (needsCsrf) {
    const token = await getCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(url, { ...options, credentials: 'same-origin', headers });
  if (res.status === 401) {
    redirectLogin('expired');
    throw new Error('401');
  }
  return res;
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(el);
  });
}
