import { Navigate } from 'react-router-dom';

/** صفحه سبد آزاد منسوخ شد — رزرو فقط از منوی هفته */
export default function FoodsPage() {
  return <Navigate to="/user/dashboard" replace />;
}
