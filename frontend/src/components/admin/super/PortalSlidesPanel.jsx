import { useEffect, useRef, useState } from 'react';
import { api, apiForm } from '../../../api/client';
import { useToast } from '../../ToastProvider';

const EMPTY_SLIDE = {
  title: '',
  description: '',
  imageUrl: '',
  tags: [],
  badge: 'اسلاید',
  enabled: true,
};

const DEBOUNCE_MS = 700;

function tagsToString(tags) {
  return Array.isArray(tags) ? tags.join('، ') : '';
}

function tagsFromString(value) {
  return String(value || '')
    .split(/[,،]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function ensureSlides(slides) {
  const list = Array.isArray(slides) && slides.length
    ? slides.map((slide) => ({
      ...EMPTY_SLIDE,
      ...slide,
      tags: Array.isArray(slide?.tags) ? slide.tags : [],
      enabled: slide?.enabled === true,
    }))
    : Array.from({ length: 6 }, () => ({ ...EMPTY_SLIDE }));
  while (list.length < 6) list.push({ ...EMPTY_SLIDE });
  return list.slice(0, 6);
}

export default function PortalSlidesPanel({ slider, onChange, onSaveStatus }) {
  const { toast } = useToast();
  const weekInputRef = useRef(null);
  const showcaseInputRefs = useRef([]);
  const [savingToggle, setSavingToggle] = useState(false);
  const debounceRef = useRef(null);
  const configRef = useRef(null);

  const loaded = Boolean(slider);
  const config = {
    weekHeroImage: slider?.weekHeroImage || '/uploads/portal-slides/morgh-torsh.jpg',
    weekHeroEnabled: loaded ? slider.weekHeroEnabled === true : true,
    showAnnouncementSlides: loaded ? slider.showAnnouncementSlides === true : true,
    showMenuFoodSlides: loaded ? slider.showMenuFoodSlides === true : true,
    showcaseSlides: ensureSlides(slider?.showcaseSlides),
  };
  configRef.current = config;

  const showcaseSlides = config.showcaseSlides;

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function emit(next) {
    onChange(next);
    configRef.current = next;
    return next;
  }

  function patch(partial) {
    return emit({ ...configRef.current, ...partial });
  }

  function patchShowcase(index, partial) {
    const current = configRef.current;
    const nextSlides = current.showcaseSlides.map((slide, i) => (
      i === index
        ? {
          ...slide,
          ...partial,
          enabled: partial.enabled !== undefined ? partial.enabled === true : slide.enabled === true,
        }
        : slide
    ));
    return patch({ showcaseSlides: nextSlides });
  }

  async function persistPortalSlider(nextConfig, { quiet = false, successMessage } = {}) {
    setSavingToggle(true);
    onSaveStatus?.('saving');
    try {
      const data = await api('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ portalSlider: nextConfig }),
      });
      if (!data.success) {
        onSaveStatus?.('error');
        toast(data.message || 'ذخیره وضعیت اسلاید ناموفق بود', 'error');
        return false;
      }
      if (data.data?.portalSlider) onChange(data.data.portalSlider);
      else onChange(nextConfig);
      onSaveStatus?.('saved');
      if (!quiet && successMessage) toast(successMessage, 'success');
      return true;
    } catch {
      onSaveStatus?.('error');
      toast('خطا در ذخیره وضعیت اسلاید', 'error');
      return false;
    } finally {
      setSavingToggle(false);
    }
  }

  function persistDebounced(nextConfig) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSaveStatus?.('saving');
    debounceRef.current = setTimeout(() => {
      persistPortalSlider(nextConfig, { quiet: true });
    }, DEBOUNCE_MS);
  }

  async function toggleShowcaseEnabled(index, enabled) {
    const next = patchShowcase(index, { enabled: enabled === true });
    await persistPortalSlider(next, {
      successMessage: enabled ? 'اسلاید فعال شد' : 'اسلاید غیرفعال شد و دیگر نمایش داده نمی‌شود',
    });
  }

  async function toggleFlag(key, value) {
    const next = patch({ [key]: value === true });
    await persistPortalSlider(next, { quiet: true });
  }

  function updateShowcaseField(index, partial) {
    const next = patchShowcase(index, partial);
    persistDebounced(next);
  }

  async function uploadImage(target, index = -1, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    fd.append('target', target);
    if (index >= 0) fd.append('index', String(index));
    fd.append('portalSlider', JSON.stringify(configRef.current));
    onSaveStatus?.('saving');
    const data = await apiForm('/api/admin/settings/portal-slide-image', fd);
    if (!data.success) {
      onSaveStatus?.('error');
      return toast(data.message || 'آپلود ناموفق بود', 'error');
    }
    onSaveStatus?.('saved');
    toast('تصویر ذخیره شد', 'success');
    if (data.imageUrl) {
      if (target === 'week') patch({ weekHeroImage: data.imageUrl });
      else if (index >= 0) patchShowcase(index, { imageUrl: data.imageUrl });
    } else if (data.data) {
      onChange(data.data);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18, borderRadius: 10 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="card-title">اسلایدهای پرتال کاربران</div>
        {savingToggle && <span className="badge badge-gray">در حال ذخیره...</span>}
      </div>
      <div className="card-body">
        <p className="form-hint" style={{ marginBottom: 16, fontSize: '.82rem', color: 'var(--text-muted)' }}>
          اسلاید اول «هفته جاری»، اسلاید دوم «اطلاعیه»، سپس اسلایدهای زیر. همه تغییرات به‌صورت خودکار ذخیره می‌شوند.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginBottom: 18 }}>
          <div className="form-group">
            <label className="form-label">نمایش اسلاید هفته جاری</label>
            <select
              className="form-control"
              value={String(config.weekHeroEnabled)}
              disabled={savingToggle}
              onChange={(e) => toggleFlag('weekHeroEnabled', e.target.value === 'true')}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">اسلاید اطلاعیه‌ها</label>
            <select
              className="form-control"
              value={String(config.showAnnouncementSlides)}
              disabled={savingToggle}
              onChange={(e) => toggleFlag('showAnnouncementSlides', e.target.value === 'true')}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">اسلاید غذاهای منوی فعال</label>
            <select
              className="form-control"
              value={String(config.showMenuFoodSlides)}
              disabled={savingToggle}
              onChange={(e) => toggleFlag('showMenuFoodSlides', e.target.value === 'true')}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </div>
        </div>

        <div className="portal-slide-admin-hero" style={{ marginBottom: 20 }}>
          <div className="portal-slide-admin-preview" style={{ backgroundImage: `url(${config.weekHeroImage || '/uploads/portal-slides/morgh-torsh.jpg'})` }}>
            <span>تصویر پس‌زمینه اسلاید هفته</span>
          </div>
          <div className="form-group" style={{ marginTop: 10 }}>
            <label className="form-label">تصویر اسلاید هفته (اسلاید اول)</label>
            <input ref={weekInputRef} className="form-control" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => uploadImage('week', -1, e.target.files?.[0])} />
          </div>
        </div>

        <div className="portal-slide-admin-grid">
          {showcaseSlides.map((slide, index) => {
            const isOn = slide.enabled === true;
            return (
              <div key={index} className={`portal-slide-admin-card${isOn ? '' : ' is-disabled'}`}>
                <div className="portal-slide-admin-card-head">
                  <strong>اسلاید {index + 1}</strong>
                  <select
                    className="form-control"
                    style={{ width: 'auto', minWidth: 110 }}
                    value={String(isOn)}
                    disabled={savingToggle}
                    onChange={(e) => toggleShowcaseEnabled(index, e.target.value === 'true')}
                  >
                    <option value="true">فعال</option>
                    <option value="false">غیرفعال</option>
                  </select>
                </div>
                {!isOn && (
                  <div className="badge badge-gray" style={{ marginBottom: 8, display: 'inline-flex' }}>
                    در پرتال نمایش داده نمی‌شود
                  </div>
                )}
                <div className="portal-slide-admin-preview small" style={{ backgroundImage: `url(${slide.imageUrl || '/uploads/portal-slides/morgh-torsh.jpg'})` }} />
                <div className="form-group">
                  <label className="form-label">موضوع</label>
                  <input className="form-control" value={slide.title || ''} onChange={(e) => updateShowcaseField(index, { title: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">توضیح یک‌خطی</label>
                  <input className="form-control" value={slide.description || ''} onChange={(e) => updateShowcaseField(index, { description: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">برچسب‌ها (با ویرگول)</label>
                  <input className="form-control" value={tagsToString(slide.tags)} onChange={(e) => updateShowcaseField(index, { tags: tagsFromString(e.target.value) })} placeholder="سنتی، گیلان" />
                </div>
                <div className="form-group">
                  <label className="form-label">نشان اسلاید</label>
                  <input className="form-control" value={slide.badge || 'اسلاید'} onChange={(e) => updateShowcaseField(index, { badge: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">تصویر</label>
                  <input
                    ref={(el) => { showcaseInputRefs.current[index] = el; }}
                    className="form-control"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => uploadImage('showcase', index, e.target.files?.[0])}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
