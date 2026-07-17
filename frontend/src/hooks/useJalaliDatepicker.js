import { useEffect } from 'react';

let watchStarted = false;

function ensureJalaliDatepicker() {
  if (typeof window === 'undefined') return null;
  const api = window.jalaliDatepicker;
  if (!api || typeof api.startWatch !== 'function') return null;
  if (!watchStarted) {
    api.startWatch({
      autoHide: true,
      hideAfterChange: true,
      showTodayBtn: true,
      showEmptyBtn: true,
      time: false,
      hasDate: true,
      separatorChars: { date: '/' },
      zIndex: 99999,
    });
    watchStarted = true;
  }
  return api;
}

/**
 * فعال‌سازی datepicker شمسی روی inputهای data-jdp
 * بعد از mount فرم، یک‌بار startWatch را صدا می‌زند.
 */
export function useJalaliDatepicker(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setTimeout(() => {
      ensureJalaliDatepicker();
    }, 50);
    return () => clearTimeout(timer);
  }, [enabled]);
}

export function showJalaliDatepicker(inputEl) {
  const api = ensureJalaliDatepicker();
  if (api && inputEl && typeof api.show === 'function') {
    try { api.show(inputEl); } catch { /* ignore */ }
  }
}
