import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <h1>مسیر یافت نشد</h1>
      <p style={{ color: 'var(--text-muted)' }}>صفحه‌ای که دنبال آن هستید وجود ندارد.</p>
      <Link to="/login" className="btn btn-primary" style={{ marginTop: 16 }}>بازگشت به ورود</Link>
    </div>
  );
}
