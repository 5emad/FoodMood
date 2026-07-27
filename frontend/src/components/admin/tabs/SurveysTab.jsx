import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import SectionHeader from '../shared/SectionHeader';
import AdminSpinner from '../shared/AdminSpinner';
import { faDigits } from '../../../utils/format';

function newLocalId() {
  return `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function MomentumChart({ points = [] }) {
  const width = 640;
  const height = 180;
  const padX = 28;
  const padY = 20;
  const usable = points.filter((p) => p.satisfactionPercent != null);
  if (!usable.length) {
    return <div className="survey-empty-chart">هنوز داده کافی برای نمودار مومنتوم نیست.</div>;
  }

  const xs = usable.map((_, i) => padX + (i * (width - padX * 2)) / Math.max(usable.length - 1, 1));
  const ys = usable.map((p) => {
    const v = Number(p.satisfactionPercent) || 0;
    return height - padY - ((v / 100) * (height - padY * 2));
  });
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  const area = `${line} L${xs[xs.length - 1]},${height - padY} L${xs[0]},${height - padY} Z`;

  return (
    <svg className="survey-momentum-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="نمودار مومنتوم رضایت">
      <defs>
        <linearGradient id="surveyMomentumFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary, #1B3F8D)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--primary, #1B3F8D)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((tick) => {
        const y = height - padY - ((tick / 100) * (height - padY * 2));
        return (
          <g key={tick}>
            <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="rgba(100,116,139,.18)" strokeWidth="1" />
            <text x={8} y={y + 3} fontSize="10" fill="#94a3b8">{tick}</text>
          </g>
        );
      })}
      <path d={area} fill="url(#surveyMomentumFill)" />
      <path d={line} fill="none" stroke="var(--primary, #1B3F8D)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {xs.map((x, i) => (
        <circle key={usable[i].date} cx={x} cy={ys[i]} r="3.5" fill="var(--primary-dark, #122A62)" />
      ))}
    </svg>
  );
}

export default function SurveysTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({ isActive: false, statements: [] });
  const [draftStatements, setDraftStatements] = useState([]);
  const [newText, setNewText] = useState('');
  const [newSentiment, setNewSentiment] = useState('positive');
  const [results, setResults] = useState(null);

  async function loadAll() {
    setLoading(true);
    const [cfg, res] = await Promise.all([
      api('/api/admin/survey'),
      api('/api/admin/survey/results?days=14'),
    ]);
    if (cfg.success) {
      setConfig(cfg.data || { isActive: false, statements: [] });
      setDraftStatements(cfg.data?.statements || []);
    }
    if (res.success) setResults(res.data);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const positive = useMemo(
    () => draftStatements.filter((s) => s.sentiment === 'positive'),
    [draftStatements],
  );
  const negative = useMemo(
    () => draftStatements.filter((s) => s.sentiment === 'negative'),
    [draftStatements],
  );

  async function toggleActive() {
    setSaving(true);
    const next = !config.isActive;
    const res = await api('/api/admin/survey/active', {
      method: 'POST',
      body: JSON.stringify({ isActive: next }),
    });
    setSaving(false);
    if (!res.success) {
      toast(res.message || 'خطا در تغییر وضعیت', 'error');
      return;
    }
    setConfig(res.data);
    toast(res.message || (next ? 'فعال شد' : 'غیرفعال شد'), 'success');
    await loadAll();
  }

  function addStatement() {
    const text = newText.trim();
    if (!text) {
      toast('متن جمله را وارد کنید', 'error');
      return;
    }
    setDraftStatements((list) => [
      ...list,
      { id: newLocalId(), text, sentiment: newSentiment },
    ]);
    setNewText('');
  }

  function removeStatement(id) {
    setDraftStatements((list) => list.filter((s) => s.id !== id));
  }

  async function saveStatements() {
    setSaving(true);
    const res = await api('/api/admin/survey/statements', {
      method: 'PUT',
      body: JSON.stringify({ statements: draftStatements }),
    });
    setSaving(false);
    if (!res.success) {
      toast(res.message || 'خطا در ذخیره جملات', 'error');
      return;
    }
    setConfig(res.data);
    setDraftStatements(res.data?.statements || []);
    toast(res.message || 'ذخیره شد', 'success');
  }

  if (loading) return <AdminSpinner />;

  const summary = results?.summary || {};

  return (
    <section id="tab-surveys" className="tab-pane active">
      <SectionHeader title="نظرسنجی" sub="فعال‌سازی، جملات بازخورد و نتایج رضایت کاربران" />

      <div className="survey-admin-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-toggle-on" /> وضعیت نظرسنجی</div>
          </div>
          <div className="card-body">
            <label className="finance-toggle">
              <input type="checkbox" checked={!!config.isActive} disabled={saving} onChange={toggleActive} />
              <span className="finance-toggle-ui" />
              <span className="finance-toggle-text">
                {config.isActive ? 'نظرسنجی فعال است — پاپ‌آپ برای کاربران نمایش داده می‌شود' : 'نظرسنجی غیرفعال است'}
              </span>
            </label>
            <p className="survey-help">
              با هر بار فعال‌سازی، دوره جدید شروع می‌شود و کاربرانی که قبلاً پاسخ داده‌اند دوباره می‌توانند شرکت کنند.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-chart-pie" /> خلاصه نتایج</div>
            <button type="button" className="btn btn-outline btn-sm" onClick={loadAll}><i className="fas fa-rotate" /> بروزرسانی</button>
          </div>
          <div className="card-body">
            <div className="survey-stats">
              <div className="mini-card"><div className="stat-label">پاسخ‌ها</div><div className="stat-value">{faDigits(summary.submittedCount || 0)}</div></div>
              <div className="mini-card"><div className="stat-label">رد شده</div><div className="stat-value">{faDigits(summary.skippedCount || 0)}</div></div>
              <div className="mini-card"><div className="stat-label">رضایت</div><div className="stat-value">{faDigits(summary.satisfactionPercent || 0)}٪</div></div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title"><i className="fas fa-comments" /> جملات مثبت و منفی</div>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={saveStatements}>
            <i className="fas fa-save" /> ذخیره جملات
          </button>
        </div>
        <div className="card-body">
          <div className="survey-statement-cols">
            <div>
              <h4 className="survey-col-title survey-col-title--pos">مثبت</h4>
              <ul className="survey-statement-list">
                {positive.map((s) => (
                  <li key={s.id}>
                    <span>{s.text}</span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => removeStatement(s.id)} title="حذف">
                      <i className="fas fa-trash" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="survey-col-title survey-col-title--neg">منفی</h4>
              <ul className="survey-statement-list">
                {negative.map((s) => (
                  <li key={s.id}>
                    <span>{s.text}</span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => removeStatement(s.id)} title="حذف">
                      <i className="fas fa-trash" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="survey-add-row">
            <select className="form-control" value={newSentiment} onChange={(e) => setNewSentiment(e.target.value)}>
              <option value="positive">مثبت</option>
              <option value="negative">منفی</option>
            </select>
            <input
              className="form-control"
              placeholder="جمله جدید..."
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addStatement(); }}
            />
            <button type="button" className="btn btn-outline" onClick={addStatement}><i className="fas fa-plus" /> افزودن</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title"><i className="fas fa-utensils" /> بهترین غذا از نظر کاربران</div>
        </div>
        <div className="card-body">
          {!(results?.foods || []).length ? (
            <div className="survey-empty-chart">هنوز رأیی برای بهترین غذا ثبت نشده است.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>غذا</th>
                    <th>رأی</th>
                    <th>سهم</th>
                  </tr>
                </thead>
                <tbody>
                  {(results.foods || []).map((f) => (
                    <tr key={f.foodId || f.foodName}>
                      <td>{f.foodName}</td>
                      <td>{faDigits(f.votes)}</td>
                      <td>
                        <div className="survey-bar-wrap">
                          <div className="survey-bar" style={{ width: `${Math.min(100, f.percent)}%` }} />
                          <span>{faDigits(f.percent)}٪</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title"><i className="fas fa-chart-line" /> مومنتوم رضایت (۱۴ روز اخیر)</div>
        </div>
        <div className="card-body">
          <MomentumChart points={results?.momentum || []} />
          <div className="survey-momentum-legend">
            محور عمودی: درصد رضایت روزانه بر اساس جملات مثبت/منفی انتخاب‌شده
          </div>
        </div>
      </div>
    </section>
  );
}
