import ErrorScreen from '../components/ErrorScreen';

export default function NotFoundPage() {
  return (
    <ErrorScreen
      code={404}
      actions={[
        { label: 'بازگشت به صفحه اصلی', href: '/login', primary: true },
      ]}
    />
  );
}
