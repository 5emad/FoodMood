export default function EmptyState({ icon = 'fa-inbox', title, desc }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><i className={`fas ${icon}`} /></div>
      <div className="empty-state-title">{title}</div>
      {desc && <div className="empty-state-desc">{desc}</div>}
    </div>
  );
}
