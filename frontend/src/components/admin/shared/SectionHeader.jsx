export default function SectionHeader({ title, sub, actions, className = '' }) {
  return (
    <div className={`section-header no-print ${className}`.trim()}>
      <div>
        <div className="section-title">{title}</div>
        {sub && <div className="section-sub">{sub}</div>}
      </div>
      {actions}
    </div>
  );
}
