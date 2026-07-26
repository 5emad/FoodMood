export default function AppVersionBadge({ version }) {
  const full = version?.appVersionFa || version?.appVersion;
  if (!full) return null;
  return (
    <div className="app-version-badge" aria-label="نسخه سامانه">
      <span className="app-version-label">نسخه</span>
      <span className="app-version-number">{full}</span>
    </div>
  );
}
