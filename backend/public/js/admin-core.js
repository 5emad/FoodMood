(function () {
  'use strict';

  if (!window.Swal) {
    window.Swal = {
      mixin: function () { return window.Swal; },
      fire: function (opts) {
        if (opts && opts.showCancelButton) {
          return Promise.resolve({ isConfirmed: window.confirm((opts.text || opts.title || '')) });
        }
        if (opts && opts.icon !== 'success') window.alert((opts.text || opts.title || ''));
        return Promise.resolve({ isConfirmed: true });
      },
    };
  }

  function loginUrl() {
    return (window.FoodMood && window.FoodMood.loginUrl)
      ? window.FoodMood.loginUrl('expired')
      : '/login?expired=1';
  }

  var csrfPromise = null;

  function resetCsrf() {
    csrfPromise = null;
  }

  function getCsrfToken() {
    if (!csrfPromise) {
      csrfPromise = fetch('/api/auth/csrf', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return (d && d.csrfToken) ? d.csrfToken : ''; })
        .catch(function () { return ''; });
    }
    return csrfPromise;
  }

  function api(url, options) {
    options = options || {};
    var method = String(options.method || 'GET').toUpperCase();
    var needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});

    var run = function () {
      return fetch(url, Object.assign({}, options, { credentials: 'same-origin', headers: headers }))
        .then(async function (r) {
          if (r.status === 403 && needsCsrf) resetCsrf();
          if (r.status === 401) {
            window.location.replace(loginUrl());
            throw new Error('401');
          }
          var text = await r.text();
          try { return JSON.parse(text); } catch (_e) { return { success: false, message: text || ('HTTP ' + r.status) }; }
        });
    };

    if (!needsCsrf) return run();
    return getCsrfToken().then(function (token) {
      if (token) headers['X-CSRF-Token'] = token;
      return run();
    });
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderPaginationBar(pagination, goFnName) {
    var totalPages = Number(pagination.totalPages || 1);
    var current = Number(pagination.page || 1);
    var total = Number(pagination.total || 0);
    if (totalPages <= 1) {
      return total ? '<div class="table-footer-meta"><span class="page-summary">' + total.toLocaleString('fa-IR') + ' رکورد</span></div>' : '';
    }
    var pages = [];
    var start = Math.max(1, current - 2);
    var end = Math.min(totalPages, current + 2);
    for (var page = start; page <= end; page += 1) pages.push(page);
    return '<div class="pagination-bar">'
      + '<button class="page-btn" ' + (current <= 1 ? 'disabled' : '') + ' onclick="' + goFnName + '(' + (current - 1) + ')">قبلی</button>'
      + pages.map(function (p) {
        return '<button class="page-btn ' + (p === current ? 'active' : '') + '" onclick="' + goFnName + '(' + p + ')">' + p.toLocaleString('fa-IR') + '</button>';
      }).join('')
      + '<button class="page-btn" ' + (current >= totalPages ? 'disabled' : '') + ' onclick="' + goFnName + '(' + (current + 1) + ')">بعدی</button>'
      + '<span class="page-summary">' + Number(pagination.total || 0).toLocaleString('fa-IR') + ' رکورد</span>'
      + '</div>';
  }

  var dialog = Swal.mixin({
    customClass: { popup: 'swal2-rtl' },
    confirmButtonText: 'باشه',
    cancelButtonText: 'انصراف',
    buttonsStyling: true,
    reverseButtons: true,
    heightAuto: false,
  });

  function notify(message, icon) {
    icon = icon || 'success';
    var typeMap = { success: 'success', error: 'error', warning: 'warning', info: 'info', question: 'info' };
    var type = typeMap[icon] || 'info';
    if (window.AppToast) return window.AppToast.show(message, type);
    window.alert(message);
    return Promise.resolve();
  }

  function showSuperToken(token) {
    return dialog.fire({
      icon: 'warning',
      title: 'توکن سوپر ادمین ساخته شد',
      html: '<div style="text-align:right;line-height:1.9">این توکن فقط همین یک بار نمایش داده می‌شود.</div>'
        + '<pre style="direction:ltr;text-align:left;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all">'
        + esc(token) + '</pre>',
      confirmButtonText: 'متوجه شدم',
      timer: undefined,
      timerProgressBar: false,
    });
  }

  async function confirmAction(opts) {
    opts = opts || {};
    var result = await dialog.fire({
      icon: opts.icon || 'question',
      title: opts.title,
      text: opts.text,
      showCancelButton: true,
      confirmButtonText: opts.confirmText || 'تایید',
      cancelButtonText: 'انصراف',
    });
    return result.isConfirmed;
  }

  var todayEl = document.getElementById('todayDate');
  if (todayEl) {
    todayEl.textContent = new Date().toLocaleDateString('fa-IR-u-ca-persian', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  window.api = api;
  window.esc = esc;
  window.renderPaginationBar = renderPaginationBar;
  window.notify = notify;
  window.showSuperToken = showSuperToken;
  window.confirmAction = confirmAction;

  function updateSecurityNotifyBadge(unreadCount) {
    var badge = document.getElementById('securityNotifyBadge');
    if (!badge) return;
    var count = Number(unreadCount || 0);
    badge.style.display = 'inline-flex';
    badge.textContent = count > 99 ? '+99' : String(count);
  }

  async function refreshSecurityNotifyBadge() {
    var badge = document.getElementById('securityNotifyBadge');
    if (!badge) return;
    try {
      var data = await api('/api/admin/security/summary');
      if (data.success) updateSecurityNotifyBadge(data.data && data.data.unreadCount);
    } catch (_e) { /* ignore */ }
  }

  refreshSecurityNotifyBadge();
  setInterval(refreshSecurityNotifyBadge, 60000);
})();
