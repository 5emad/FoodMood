import { useEffect } from 'react';

let watchStarted = false;

function bridgeJalaliInput(el) {
  if (!el || el.dataset.jdpBridged === '1') return;
  el.dataset.jdpBridged = '1';
  // jalaliDatepicker معمولاً فقط change می‌زند؛ React به input گوش می‌دهد
  el.addEventListener('change', () => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function bridgeAllJalaliInputs(root = document) {
  root.querySelectorAll?.('input[data-jdp]')?.forEach(bridgeJalaliInput);
}

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
  bridgeAllJalaliInputs();
  return api;
}

/**
 * فعال‌سازی datepicker شمسی روی inputهای data-jdp
 * و همگام‌سازی با React (رویداد input).
 */
export function useJalaliDatepicker(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;

    const run = () => ensureJalaliDatepicker();
    const timer = setTimeout(run, 40);
    const timer2 = setTimeout(run, 200);

    const observer = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => bridgeAllJalaliInputs())
      : null;
    observer?.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      observer?.disconnect();
    };
  }, [enabled]);
}

export function showJalaliDatepicker(inputEl) {
  const api = ensureJalaliDatepicker();
  if (api && inputEl && typeof api.show === 'function') {
    try { api.show(inputEl); } catch { /* ignore */ }
  }
}

/** خواندن مقدار تاریخ از input (حتی اگر state هنوز sync نشده باشد) */
export function readJalaliInputValue(inputEl) {
  if (!inputEl) return '';
  return String(inputEl.value || '').trim();
}
