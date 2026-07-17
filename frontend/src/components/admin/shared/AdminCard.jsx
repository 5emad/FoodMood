export default function AdminCard({ title, icon, badge, actions, children, className = '', bodyClass = 'card-body' }) {
  return (
    <div className={`card ${className}`.trim()}>
      {(title || actions) && (
        <div className="card-header">
          {title && (
            <div className="card-title">
              {icon && <i className={`fas ${icon}`} style={{ marginLeft: 8, color: 'var(--primary)' }} />}
              {title}
            </div>
          )}
          {badge}
          {actions}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  );
}
