export default function AdminSpinner({ padding = 32 }) {
  return (
    <div style={{ padding, textAlign: 'center' }}>
      <div className="spinner" />
    </div>
  );
}
