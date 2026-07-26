import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';

const PUBLIC_PATHS = ['/login', '/service-unavailable'];

function isPublicPath(pathname) {
  if (!pathname) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Silent idle session enforcement: after inactivity, destroy server session via /logout.
 * Does not surface security messaging to the user.
 */
export default function SessionIdleGuard() {
  const location = useLocation();

  useEffect(() => {
    if (isPublicPath(location.pathname)) return undefined;

    let idleMs = 15 * 60 * 1000;
    let idleTimer = null;
    let lastPingAt = 0;
    let armed = false;
    let cancelled = false;

    const forceLogout = () => {
      if (cancelled) return;
      window.location.replace('/logout');
    };

    const scheduleIdle = () => {
      if (!armed || cancelled) return;
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(forceLogout, idleMs);
    };

    const softPing = () => {
      const now = Date.now();
      const pingEvery = Math.min(Math.max(Math.floor(idleMs / 3), 60 * 1000), 5 * 60 * 1000);
      if (now - lastPingAt < pingEvery) return;
      lastPingAt = now;
      api('/api/auth/ping')
        .then((res) => {
          if (cancelled) return;
          if (res?.policy?.idleMs && Number(res.policy.idleMs) > 0) {
            idleMs = Number(res.policy.idleMs);
          }
        })
        .catch(() => {
          /* next authenticated call will handle expiry */
        });
    };

    const onActivity = () => {
      if (document.visibilityState === 'hidden') return;
      scheduleIdle();
      softPing();
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onActivity);

    api('/api/auth/ping')
      .then((res) => {
        if (cancelled || !res?.success) return;
        if (res?.policy?.idleMs && Number(res.policy.idleMs) > 0) {
          idleMs = Number(res.policy.idleMs);
        }
        armed = true;
        lastPingAt = Date.now();
        scheduleIdle();
      })
      .catch(() => {
        /* anonymous / expired — no guard */
      });

    return () => {
      cancelled = true;
      if (idleTimer) window.clearTimeout(idleTimer);
      events.forEach((evt) => window.removeEventListener(evt, onActivity));
      document.removeEventListener('visibilitychange', onActivity);
    };
  }, [location.pathname]);

  return null;
}
