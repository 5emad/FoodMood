(function () {
  'use strict';

  var text = 'کاربر عزیز، لطفاً نام و واحد سازمانی خود را تکمیل کنید';
  var target = document.getElementById('typed');
  var index = 0;

  function typeNext() {
    if (!target) return;
    target.textContent = text.slice(0, index);
    index += 1;
    if (index <= text.length) setTimeout(typeNext, 38);
  }
  typeNext();

  var form = document.getElementById('profileForm');
  var input = document.getElementById('fullName');
  var deptSelect = document.getElementById('departmentId');
  var error = document.getElementById('error');
  var button = document.getElementById('submitBtn');
  var persianName = /^[\u0600-\u06FF\s\u200c]{3,80}$/;

  if (!form) return;

  function showError(message) {
    if (!error) return;
    error.style.display = 'block';
    error.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + String(message || '');
  }

  function clearError() {
    if (!error) return;
    error.style.display = 'none';
    error.textContent = '';
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var value = input.value.trim();
    var departmentId = deptSelect ? String(deptSelect.value || '').trim() : '';
    clearError();

    if (!persianName.test(value) || value.split(/\s+/).filter(Boolean).length < 2) {
      showError('نام و نام خانوادگی را کامل و به فارسی وارد کنید.');
      input.focus();
      return;
    }

    if (!departmentId) {
      showError('لطفاً واحد سازمانی خود را انتخاب کنید.');
      if (deptSelect) deptSelect.focus();
      return;
    }

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> در حال ثبت...';

    try {
      var response = await fetch('/api/auth/set-fullname', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: value, departmentId: departmentId }),
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'ثبت پروفایل انجام نشد');
      var me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return null; });
      var role = me && me.user && me.user.role;
      var path = (role === 'admin' || role === 'superadmin') ? '/admin/dashboard' : '/user/dashboard';
      var next = (window.FoodMood && window.FoodMood.appPath)
        ? window.FoodMood.appPath(path)
        : path;
      window.location.href = next;
    } catch (err) {
      showError(err.message || 'خطا در ارتباط با سرور');
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-arrow-left"></i> ورود به سامانه';
    }
  });
})();
