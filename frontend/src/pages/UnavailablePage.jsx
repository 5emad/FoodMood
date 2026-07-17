import { useEffect } from 'react';

export default function UnavailablePage() {
  useEffect(() => {
    const t = setInterval(() => window.location.reload(), 120000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="unavailable-shell">
      <div className="unavailable-card">
        <h1>سامانه در دسترس نیست</h1>
        <p>اتصال به پایگاه داده برقرار نیست. لطفاً چند دقیقه دیگر دوباره تلاش کنید.</p>
      </div>
    </div>
  );
}
