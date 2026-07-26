export default function AppVersionBadge({ version }) {
  const full = version?.appVersionFa || version?.appVersion;
  if (!full) return null;
  const prev = version?.previousAppVersionFa || version?.previousAppVersion;
  return (
    <div className="app-version-badge" aria-label="نسخه سامانه">
      <span className="app-version-label">نسخه</span>
      <span className="app-version-number">{full}</span>
      {prev && prev !== full && (
        <span className="app-version-detail"> (قبلی: {prev})</span>
      )}
    </div>
  );
}
