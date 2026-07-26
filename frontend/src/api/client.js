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

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  const isAuthCredentialCall = /\/api\/auth\/(login|resolve-username|verify-super-token)(?:\?|$)/.test(url);
  if (res.status === 401) {
    if (isAuthCredentialCall) {
      return body || { success: false, message: 'اطلاعات وارد شده صحیح نیست' };
    }
    redirectLogin(body?.code === 'idle' ? 'idle' : 'expired');
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

export async function apiForm(url, formData, method = 'POST') {
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());
  const headers = {};
  if (needsCsrf) {
    const token = await getCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(url, { method, credentials: 'same-origin', headers, body: formData });
  if (res.status === 401) {
    redirectLogin('expired');
    throw new Error('401');
  }
  if (res.status === 403 && needsCsrf) resetCsrf();
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, message: text || `HTTP ${res.status}` };
  }
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

