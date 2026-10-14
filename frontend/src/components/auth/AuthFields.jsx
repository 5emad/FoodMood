import { useCallback, useEffect, useState } from 'react';

export function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div className="fm-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="fm-hint">{hint}</span>}
      {error && <span className="fm-field-error" role="alert">{error}</span>}
    </div>
  );
}

export function PasswordInput({ id, invalid, ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="fm-input-group">
      <input
        {...props}
        id={id}
        type={visible ? 'text' : 'password'}
        className={`fm-input${invalid ? ' is-invalid' : ''}`}
        dir="ltr"
        spellCheck="false"
        autoCapitalize="none"
        aria-invalid={invalid ? 'true' : undefined}
      />
      <button
        type="button"
        className="fm-adornment"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'پنهان کردن رمز' : 'نمایش رمز'}
        title={visible ? 'پنهان کردن رمز' : 'نمایش رمز'}
        tabIndex={-1}
      >
        <i className={`fas ${visible ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Server-generated image captcha. Bump `version` after every attempt to get a fresh image
 * (each challenge is single-use on the server).
 */
export function Captcha({ value, onChange, version, error, endpoint = '/api/auth/captcha' }) {
  const [image, setImage] = useState('');
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const body = await res.json().catch(() => null);
      setImage(body?.success && body.data?.image ? body.data.image : '');
    } catch {
      setImage('');
    } finally {
      setLoading(false);
      onChange('');
    }
  }, [onChange, endpoint]);

  useEffect(() => {
    reload();
  }, [reload, version]);

  return (
    <Field label="کد امنیتی" htmlFor="fm-captcha" error={error}>
      <div className={`fm-captcha${error ? ' is-invalid' : ''}`}>
        <input
          id="fm-captcha"
          className="fm-input"
          placeholder="کد داخل تصویر"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\s+/g, '').toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          maxLength={8}
          dir="ltr"
          required
        />
        {image
          ? <img src={image} alt="کد امنیتی" className="fm-captcha-img" width="150" height="44" />
          : <span className="fm-captcha-img" aria-hidden="true" />}
        <button
          type="button"
          className="fm-btn fm-btn-ghost fm-btn-icon"
          onClick={reload}
          disabled={loading}
          aria-label="کد جدید"
          title="کد جدید"
        >
          <i className={`fas fa-rotate${loading ? ' fa-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </Field>
  );
}
