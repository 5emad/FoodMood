import { useEffect } from 'react';
import BrandLogo from '../BrandLogo';

/**
 * Full-screen auth layout (login / register): dark brand background, logo + organization name
 * above a white card, version at the bottom.
 */
export default function AuthShell({ title, brand, version, children, wide = false }) {
  useEffect(() => {
    document.body.classList.add('fm-auth-page');
    return () => document.body.classList.remove('fm-auth-page');
  }, []);

  return (
    <main className="fm-auth-bg">
      <div className="fm-auth-wrap">
        <div className="fm-auth-logo">
          <BrandLogo size={84} />
          <span className="fm-auth-wordmark">{brand || 'سامانه تغذیه'}</span>
          <span className="fm-auth-tagline">سامانه رزرو غذای سازمانی</span>
        </div>
        <section className={`fm-auth-card${wide ? ' fm-auth-card--wide' : ''}`} aria-labelledby="fm-auth-title">
          <h1 id="fm-auth-title">{title}</h1>
          {children}
        </section>
      </div>
      <div className="fm-auth-version">نسخه {version || '—'}</div>
    </main>
  );
}
