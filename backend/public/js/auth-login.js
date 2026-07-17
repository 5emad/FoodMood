(function () {
  'use strict';

  function initCarousel() {
    var slides = Array.prototype.slice.call(document.querySelectorAll('#authSideCarousel .auth-side-slide'));
    var dots = Array.prototype.slice.call(document.querySelectorAll('#authSideDots [data-slide]'));
    if (!slides.length || !dots.length) return;

    var index = 0;
    var timer = null;

    function showSlide(next) {
      index = (next + slides.length) % slides.length;
      slides.forEach(function (slide, i) { slide.classList.toggle('active', i === index); });
      dots.forEach(function (dot, i) {
        var on = i === index;
        dot.classList.toggle('active', on);
        dot.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    function startAuto() {
      if (timer) clearInterval(timer);
      timer = setInterval(function () { showSlide(index + 1); }, 4500);
    }

    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        showSlide(Number(dot.dataset.slide) || 0);
        startAuto();
      });
    });

    showSlide(0);
    startAuto();
  }

  function appPath(path) {
    return (window.FoodMood && window.FoodMood.appPath)
      ? window.FoodMood.appPath(path)
      : path;
  }

  function clearAlerts() {
    document.querySelectorAll('.auth-card .alert').forEach(function (el) { el.remove(); });
  }

  function showAlert(message, type) {
    clearAlerts();
    var form = document.getElementById('loginForm');
    if (!form) return;
    var alert = document.createElement('div');
    alert.className = 'alert alert-' + (type === 'info' ? 'warning' : (type || 'danger'));
    var icon = document.createElement('i');
    icon.className = type === 'info' ? 'fas fa-shield-halved' : 'fas fa-exclamation-triangle';
    alert.appendChild(icon);
    alert.appendChild(document.createTextNode(' ' + String(message || '')));
    form.before(alert);
  }

  function setButtonState(btn, html, disabled) {
    btn.innerHTML = html;
    btn.disabled = !!disabled;
  }

  function redirectAfterLogin(user) {
    if (user && user.mustSetFullName) {
      window.location.href = appPath('/complete-profile');
      return;
    }
    var role = user && user.role;
    window.location.href = (role === 'admin' || role === 'superadmin')
      ? appPath('/admin/dashboard')
      : appPath('/user/dashboard');
  }

  function enterSecondStep(message) {
    var form = document.getElementById('loginForm');
    var group = document.getElementById('superTokenGroup');
    var tokenInput = document.getElementById('superToken');
    var username = document.getElementById('username');
    var password = document.getElementById('password');
    var submitButton = form.querySelector('button[type="submit"]');
    if (!form || !group || !tokenInput || !submitButton) return;

    group.style.display = 'block';
    tokenInput.required = true;
    if (username) username.disabled = true;
    if (password) password.disabled = true;
    form.dataset.mode = '2fa';
    setButtonState(submitButton, '<i class="fas fa-shield-halved"></i> تایید توکن امنیتی', false);
    showAlert(message || 'مرحله دوم احراز هویت را تکمیل کنید.', 'info');
    tokenInput.focus();
  }

  function resetLogin() {
    var form = document.getElementById('loginForm');
    if (!form) return;
    form.dataset.mode = '';
    var group = document.getElementById('superTokenGroup');
    var tokenInput = document.getElementById('superToken');
    var username = document.getElementById('username');
    var password = document.getElementById('password');
    if (group) group.style.display = 'none';
    if (tokenInput) { tokenInput.required = false; tokenInput.value = ''; }
    if (username) username.disabled = false;
    if (password) password.disabled = false;
    clearAlerts();
  }

  function initLoginForm() {
    var form = document.getElementById('loginForm');
    if (!form) return;

    var submitButton = form.querySelector('button[type="submit"]');
    var defaultButtonHtml = submitButton.innerHTML;
    var secondStepHtml = '<i class="fas fa-shield-halved"></i> تایید توکن امنیتی';

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var mode = form.dataset.mode || 'login';

      if (mode === '2fa') {
        setButtonState(submitButton, '<i class="fas fa-circle-notch fa-spin"></i> در حال تایید...', true);
        try {
          var verifyRes = await fetch('/api/auth/verify-super-token', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: document.getElementById('superToken').value }),
          });
          if (verifyRes.status === 429) {
            showAlert('تعداد تلاش‌ها بیش از حد مجاز است. چند دقیقه بعد دوباره تلاش کنید.');
            return;
          }
          var verifyData = await verifyRes.json();
          if (verifyData.success) {
            window.location.href = appPath('/admin/dashboard');
            return;
          }
          showAlert(verifyData.message || 'توکن وارد شده معتبر نیست.');
        } catch (_err) {
          showAlert('خطا در ارتباط با سرور');
        } finally {
          setButtonState(submitButton, secondStepHtml, false);
        }
        return;
      }

      setButtonState(submitButton, '<i class="fas fa-circle-notch fa-spin"></i> در حال ورود...', true);
      try {
        var response = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('username').value.trim(),
            password: document.getElementById('password').value,
          }),
        });
        var data = await response.json();

        if (data.tokenRequired) {
          enterSecondStep(data.message);
          return;
        }

        if (data.success) {
          redirectAfterLogin(data.user);
          return;
        }

        showAlert(data.message || 'اطلاعات ورود صحیح نیست');
      } catch (_err) {
        showAlert('خطا در ارتباط با سرور');
      } finally {
        if (form.dataset.mode !== '2fa') {
          setButtonState(submitButton, defaultButtonHtml, false);
        }
      }
    });

    var restart = document.getElementById('loginRestart');
    if (restart) {
      restart.addEventListener('click', function () {
        resetLogin();
        setButtonState(submitButton, defaultButtonHtml, false);
      });
    }
  }

  initCarousel();
  initLoginForm();
})();
