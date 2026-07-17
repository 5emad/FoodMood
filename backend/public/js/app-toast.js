/**
 * Unified RTL toast notifications (user portal + admin panel).
 * Replaces SweetAlert modals for routine success/error feedback.
 */
(function (global) {
  'use strict';

  var ICONS = {
    success: 'fa-check',
    error: 'fa-xmark',
    warning: 'fa-exclamation',
    info: 'fa-info',
  };

  var DEFAULT_DURATION = { success: 3200, error: 4500, warning: 3800, info: 3200 };
  var MAX_VISIBLE = 4;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function ensureContainer() {
    var el = document.getElementById('toast-container');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'toast-container';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'false');
    document.body.appendChild(el);
    return el;
  }

  function dismiss(el) {
    if (!el || el.dataset.dismissed === '1') return;
    el.dataset.dismissed = '1';
    el.classList.add('is-leaving');
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 320);
  }

  function show(message, type) {
    type = type || 'success';
    if (!ICONS[type]) type = 'info';

    var container = ensureContainer();
    while (container.children.length >= MAX_VISIBLE) {
      dismiss(container.firstElementChild);
    }

    var el = document.createElement('div');
    el.className = 'app-toast app-toast--' + type;
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<button type="button" class="app-toast__close" aria-label="بستن">&times;</button>'
      + '<span class="app-toast__text">' + esc(message) + '</span>'
      + '<span class="app-toast__icon" aria-hidden="true"><i class="fas ' + ICONS[type] + '"></i></span>';

    var closeBtn = el.querySelector('.app-toast__close');
    closeBtn.addEventListener('click', function () { dismiss(el); });

    container.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-visible'); });

    var duration = DEFAULT_DURATION[type] || 3200;
    var timer = window.setTimeout(function () { dismiss(el); }, duration);
    el.addEventListener('mouseenter', function () { window.clearTimeout(timer); });
    el.addEventListener('mouseleave', function () {
      timer = window.setTimeout(function () { dismiss(el); }, 1400);
    });

    return el;
  }

  var AppToast = {
    show: show,
    success: function (msg) { return show(msg, 'success'); },
    error: function (msg) { return show(msg, 'error'); },
    warning: function (msg) { return show(msg, 'warning'); },
    info: function (msg) { return show(msg, 'info'); },
  };

  global.AppToast = AppToast;
  global.toast = show;
})(typeof window !== 'undefined' ? window : global);
