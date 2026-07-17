import { useRef, useState } from 'react';
import { apiBlob, apiForm, downloadBlob } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';

export default function SuperBackupPanel() {
  const { toast } = useToast();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  const fileInputRef = useRef(null);

  async function exportBackup() {
    setBusy('export');
    try {
      const res = await apiBlob('/api/admin/backup/export');
      if (!res.ok) { toast('خطا در پشتیبان', 'error'); return; }
      downloadBlob(await res.blob(), `sazman-food-backup-${new Date().toISOString().slice(0, 10)}.fzbackup`);
      toast('پشتیبان دانلود شد', 'success');
    } catch { toast('خطا', 'error'); }
    finally { setBusy(''); }
  }

  async function restore() {
    if (!file) return toast('فایل را انتخاب کنید', 'warning');
    if (!(await confirmAction({ title: 'بازیابی کامل داده‌ها؟', text: 'تمام داده‌های فعلی جایگزین می‌شوند. قبل از بازیابی حتماً یک نسخه پشتیبان جدید بگیرید.', confirmText: 'بله، بازیابی کن', icon: 'warning' }))) return;
    setBusy('restore');
    try {
      const form = new FormData();
      form.append('backupFile', file);
      const data = await apiForm('/api/admin/backup/restore', form);
      if (data.success) { toast(data.message || 'بازیابی انجام شد', 'success'); setTimeout(() => window.location.reload(), 1800); }
      else toast(data.message || 'خطا', 'error');
    } catch { toast('خطا', 'error'); }
    finally { setBusy(''); }
  }

  return (
    <section className="super-page-section">
      <div className="backup-grid">
        <div className="card backup-card">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-download" style={{ marginLeft: 8, color: 'var(--primary)' }} /> دریافت پشتیبان</div>
          </div>
          <div className="card-body">
            <p className="backup-desc">یک فایل اختصاصی <code>.fzbackup</code> از تمام داده‌های سامانه دریافت کنید.</p>
            <ul className="backup-features">
              <li><i className="fas fa-lock" /> رمزنگاری AES-256-GCM</li>
              <li><i className="fas fa-fingerprint" /> امضای دیجیتال</li>
              <li><i className="fas fa-file-shield" /> فرمت اختصاصی سامانه</li>
            </ul>
            <button type="button" className="btn btn-primary" id="exportBackupBtn" disabled={busy === 'export'} onClick={exportBackup}>
              {busy === 'export' ? <i className="fas fa-circle-notch fa-spin" /> : <i className="fas fa-cloud-download-alt" />} دانلود فایل پشتیبان
            </button>
          </div>
        </div>

        <div className="card backup-card backup-card-danger">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-upload" style={{ marginLeft: 8, color: 'var(--danger)' }} /> بازیابی از پشتیبان</div>
            <span className="badge badge-danger">حساس</span>
          </div>
          <div className="card-body">
            <div className="alert alert-warning">
              <i className="fas fa-triangle-exclamation" />
              {' '}بازیابی تمام داده‌های فعلی را جایگزین می‌کند. قبل از بازیابی حتماً یک نسخه پشتیبان جدید بگیرید.
            </div>
            <div className="backup-upload-zone" id="backupDropZone">
              <input ref={fileInputRef} type="file" id="backupFileInput" accept=".fzbackup" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <i className="fas fa-file-archive backup-upload-icon" />
              <div className="backup-upload-title">فایل پشتیبان را انتخاب کنید</div>
              <div className="backup-upload-sub">فقط فایل‌های <code>.fzbackup</code></div>
              <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => fileInputRef.current?.click()}>
                <i className="fas fa-folder-open" /> انتخاب فایل
              </button>
              {file && <div id="backupFileName" className="backup-file-name">{file.name}</div>}
            </div>
            <button type="button" className="btn btn-danger btn-w100 mt-3" id="restoreBackupBtn" disabled={!file || busy === 'restore'} onClick={restore}>
              {busy === 'restore' ? <i className="fas fa-circle-notch fa-spin" /> : <i className="fas fa-rotate-left" />} بازیابی داده‌ها
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
