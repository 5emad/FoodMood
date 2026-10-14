let csrfPromise = null;
let pathRewrite = null;
let unauthorizedHandler = null;

/**
 * پرتال مهمان همان صفحه کاربران را با مسیرهای /api/guest استفاده می‌کند.
 * fn(path) => path جدید؛ null = غیرفعال
 */
export function setApiPathRewrite(fn) {
  pathRewrite = typeof fn === 'function' ? fn : null;
}

/** به‌جای انتقال به /login (مثلاً بازگشت به صفحه ورود مهمان) */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null;
}

/** آدرس نهایی API (برای <img src> و لینک‌هایی که از api() رد نمی‌شوند) */
export function apiUrl(url) {
  return pathRewrite ? pathRewrite(url) : url;
}

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
  if (unauthorizedHandler) {
    unauthorizedHandler(reason);
    return;
  }
  if (window.location.pathname.includes('/login')) return;
  const q = reason === 'idle' ? 'idle=1' : reason === 'inactive' ? 'inactive=1' : 'expired=1';
  window.location.replace(`/login?${q}`);
}

export async function api(rawUrl, options = {}) {
  const url = apiUrl(rawUrl);
  const method = String(options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  let attempt = 0;
  let res;
  let text;
  let body;

  while (attempt < 2) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

    if (needsCsrf) {
      const token = await getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }

    res = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers,
    });

    text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (res.status === 403 && needsCsrf && body?.code === 'CSRF_INVALID' && attempt === 0) {
      resetCsrf();
      attempt += 1;
      continue;
    }

    if (res.status === 403 && needsCsrf) resetCsrf();
    break;
  }

  const isAuthCredentialCall = /\/api\/auth\/(login|resolve-username|verify-super-token)(?:\?|$)/.test(url)
    || /\/api\/guest\/(login|magic)(?:\?|$)/.test(url);
  if (res.status === 401 || (res.status === 403 && body?.code === 'inactive')) {
    if (isAuthCredentialCall) {
      return body || { success: false, message: 'اطلاعات وارد شده صحیح نیست' };
    }
    const reason = body?.code === 'idle' ? 'idle' : body?.code === 'inactive' ? 'inactive' : 'expired';
    redirectLogin(reason);
    throw new Error(body?.message || 'نشست منقضی شده است');
  }

  if (res.status === 403 && isAuthCredentialCall) {
    return body || { success: false, message: 'دسترسی مجاز نیست' };
  }

  // WAF false-positive on app surface — don't look like a hard auth failure
  if (body?.code === 'WAF_SOFT' || body?.code === 'WAF_BLOCKED') {
    return {
      success: false,
      message: body.message || 'لایه امنیتی درخواست را رد کرد',
      code: body.code,
      _httpStatus: res.status,
    };
  }

  if (body && typeof body === 'object') {
    return { ...body, _httpStatus: res.status };
  }
  return { success: false, message: text || `HTTP ${res.status}`, _httpStatus: res.status };
}

export async function apiBlob(rawUrl, options = {}) {
  const url = apiUrl(rawUrl);
  const method = String(options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  let attempt = 0;
  let res;

  while (attempt < 2) {
    const headers = { ...(options.headers || {}) };
    if (needsCsrf) {
      const token = await getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }
    res = await fetch(url, { ...options, credentials: 'same-origin', headers });
    if (res.status === 403 && needsCsrf && attempt === 0) {
      const body = await res.clone().json().catch(() => null);
      if (body?.code === 'CSRF_INVALID') {
        resetCsrf();
        attempt += 1;
        continue;
      }
    }
    if (res.status === 403 && needsCsrf) resetCsrf();
    break;
  }
  if (res.status === 401) {
    redirectLogin('expired');
    throw new Error('401');
  }
  return res;
}

export async function apiForm(rawUrl, formData, method = 'POST') {
  const url = apiUrl(rawUrl);
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());
  let attempt = 0;
  let res;
  let text;
  let body;

  while (attempt < 2) {
    const headers = {};
    if (needsCsrf) {
      const token = await getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }
    res = await fetch(url, { method, credentials: 'same-origin', headers, body: formData });
    text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    if (res.status === 403 && needsCsrf && body?.code === 'CSRF_INVALID' && attempt === 0) {
      resetCsrf();
      attempt += 1;
      continue;
    }

    if (res.status === 403 && needsCsrf) resetCsrf();
    break;
  }
  if (res.status === 401) {
    redirectLogin('expired');
    throw new Error('401');
  }
  return body || { success: false, message: text || `HTTP ${res.status}` };
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
