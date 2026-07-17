export default function SearchGroup({ value, onChange, onSearch, onClear, placeholder, type = 'text', min, className = '' }) {
  return (
    <div className={`search-group ${className}`.trim()}>
      <i className="fas fa-search search-group-icon" />
      <input
        type={type}
        min={min}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSearch?.(); }}
      />
      {onClear && (
        <button type="button" className="search-clear" onClick={onClear} title="پاک کردن جستجو">
          <i className="fas fa-times" />
        </button>
      )}
      {onSearch && <button type="button" className="search-go" onClick={onSearch}>جستجو</button>}
    </div>
  );
}
