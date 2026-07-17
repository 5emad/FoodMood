(function (win) {
  'use strict';

  function readAppBase() {
    var meta = document.querySelector('meta[name="app-base"]');
    return meta ? String(meta.getAttribute('content') || '').trim() : '';
  }

  function appPath(path) {
    var normalized = String(path || '/');
    if (normalized.charAt(0) !== '/') normalized = '/' + normalized;
    var base = readAppBase();
    return base ? base.replace(/\/$/, '') + normalized : normalized;
  }

  function loginUrl(reason) {
    var query = reason === 'idle' ? 'idle=1' : 'expired=1';
    return appPath('/login?' + query);
  }

  win.FoodMood = win.FoodMood || {};
  win.FoodMood.appPath = appPath;
  win.FoodMood.loginUrl = loginUrl;
})(window);
