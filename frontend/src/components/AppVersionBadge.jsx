export default function AppVersionBadge({ version }) {
  if (!version?.appVersionMajorFa) return null;
  const showDetail = version.appVersion && String(version.appVersion) !== String(version.appVersionMajor);
  return (
    <div className="app-version-badge" aria-label="نسخه سامانه">
      <span className="app-version-label">نسخه</span>
      <span className="app-version-number">{version.appVersionMajorFa}</span>
      {showDetail && <span className="app-version-detail">({version.appVersionFa})</span>}
    </div>
  );
}
