import { useRef, useState } from 'react';
import { apiBlob, apiForm, downloadBlob } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';

async function readErrorMessage(res, fallback) {
  try {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const json = JSON.parse(text);
      return json.message || fallback;
    } catch {
      return text.slice(0, 200) || fallback;
    }
  } catch {
    return fallback;
  }
}

function filenameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const utf = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) {
    try { return decodeURIComponent(utf[1]); } catch { /* ignore */ }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain?.[1] || fallback;
}

function localBackupFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `sazman-food-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.fzbackup`;
}

export default function BackupTab() {
  const { toast } = useToast();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function pickFile(next) {
    if (!next) {
      setFile(null);
      return;
    }
    if (!String(next.name || '').toLowerCase().endsWith('.fzbackup')) {
      toast('فقط فایل با پسوند .fzbackup مجاز است', 'error');
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function exportBackup() {
    setBusy('export');
    try {
      const res = await apiBlob('/api/admin/backup/export');
      if (!res.ok) {
        toast(await readErrorMessage(res, 'خطا در ساخت پشتیبان'), 'error');
        return;
      }
      const fallback = localBackupFilename();
      const name = filenameFromDisposition(res.headers.get('Content-Disposition'), fallback);
      downloadBlob(await res.blob(), name);
      toast('پشتیبان دانلود شد — این فایل را در جای امن نگه دارید', 'success');
    } catch (err) {
      toast(err.message || 'خطا در دانلود پشتیبان', 'error');
    } finally {
      setBusy('');
    }
  }

  async function restore() {
    if (!file) return toast('فایل را انتخاب کنید', 'warning');
    if (!(await confirmAction({
      title: 'بازیابی کامل داده‌ها؟',
      text: 'تمام داده‌های فعلی جایگزین می‌شوند. قبل از بازیابی حتماً یک نسخه پشتیبان جدید بگیرید.',
      confirmText: 'بله، بازیابی کن',
      icon: 'warning',
    }))) return;

    setBusy('restore');
    try {
      const form = new FormData();
      form.append('backupFile', file, file.name || 'backup.fzbackup');
      const data = await apiForm('/api/admin/backup/restore', form);
      if (data.success) {
        toast(data.message || 'بازیابی انجام شد', 'success');
        setTimeout(() => window.location.reload(), 1800);
      } else {
        toast(data.message || 'بازیابی ناموفق بود', 'error');
      }
    } catch (err) {
      toast(err.message || 'خطا در ارسال فایل پشتیبان', 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <section id="tab-backup" className="tab-pane active">
      <SectionHeader title="پشتیبان" sub="خروجی رمزنگاری‌شده و بازیابی کامل داده‌های سامانه" />
      <div className="backup-grid">
        <div className="card backup-card">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-download" style={{ marginLeft: 8, color: 'var(--primary)' }} /> دریافت پشتیبان</div>
          </div>
          <div className="card-body">
            <p className="backup-desc">فایل <code>.fzbackup</code> شامل کاربران (رمز فقط برای کاربران محلی؛ LDAP بدون رمز)، غذاها، سفارش‌ها، هفته‌ها، مهمان‌ها و تنظیمات است.</p>
            <ul className="backup-features">
              <li><i className="fas fa-lock" /> رمزنگاری AES-256-GCM</li>
              <li><i className="fas fa-fingerprint" /> امضای دیجیتال HMAC</li>
              <li><i className="fas fa-user-shield" /> کاربران LDAP بدون ذخیره رمز محلی</li>
            </ul>
            <div className="backup-card-actions">
              <button type="button" className="btn btn-primary" disabled={busy === 'export'} onClick={exportBackup}>
                {busy === 'export' ? <i className="fas fa-circle-notch fa-spin" /> : <i className="fas fa-cloud-download-alt" />} دانلود فایل پشتیبان
              </button>
            </div>
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
            <div
              className={`backup-upload-zone${dragOver ? ' is-dragover' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFile(e.dataTransfer.files?.[0] || null);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".fzbackup,application/octet-stream"
                hidden
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
              />
              <i className="fas fa-file-archive backup-upload-icon" />
              <div className="backup-upload-title">فایل را بکشید و رها کنید یا انتخاب کنید</div>
              <div className="backup-upload-sub">فقط <code>.fzbackup</code> — حداکثر ۲۰۰ مگابایت</div>
              <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => fileInputRef.current?.click()}>
                <i className="fas fa-folder-open" /> انتخاب فایل
              </button>
              {file && (
                <div className="backup-file-name">
                  {file.name} ({(file.size / 1024).toFixed(1)} کیلوبایت)
                </div>
              )}
            </div>
            <div className="backup-card-actions">
              <button type="button" className="btn btn-danger btn-w100" disabled={!file || busy === 'restore'} onClick={restore}>
                {busy === 'restore' ? <i className="fas fa-circle-notch fa-spin" /> : <i className="fas fa-rotate-left" />} بازیابی داده‌ها
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
