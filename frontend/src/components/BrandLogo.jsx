import { useId } from 'react';

/**
 * FoodMood brand mark: a smiling bowl with warm steam on the brand teal tile.
 * Inline SVG (no network request); gradient ids are unique per instance.
 */
export default function BrandLogo({ size = 40, className = '', title = 'لوگوی سامانه' }) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bg = `fm-bg-${raw}`;
  const steam = `fm-steam-${raw}`;
  const bowl = `fm-bowl-${raw}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="img"
      aria-label={title}
      className={className}
      focusable="false"
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4D73B5" />
          <stop offset="1" stopColor="#122A62" />
        </linearGradient>
        <linearGradient id={steam} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#FCD34D" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id={bowl} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DCE5F7" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="30" fill={`url(#${bg})`} />
      <circle cx="30" cy="22" r="44" fill="#FFFFFF" opacity=".08" />
      <g fill="none" stroke={`url(#${steam})`} strokeWidth="6" strokeLinecap="round">
        <path d="M47 54c-7-6 7-11 0-19" />
        <path d="M64 52c-7-7 7-13 0-22" />
        <path d="M81 54c-7-6 7-11 0-19" />
      </g>
      <path d="M18 62h92a46 41 0 0 1 -92 0z" fill={`url(#${bowl})`} />
      <rect x="44" y="100" width="40" height="8" rx="4" fill="#FFFFFF" opacity=".92" />
      <circle cx="51" cy="74" r="4" fill="#1B3F8D" />
      <circle cx="77" cy="74" r="4" fill="#1B3F8D" />
      <path d="M50 84q14 11 28 0" fill="none" stroke="#1B3F8D" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}
