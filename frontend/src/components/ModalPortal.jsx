import { createPortal } from 'react-dom';

/**
 * پاپ‌آپ‌ها مستقیم زیر <body> رندر می‌شوند.
 * والدِ دارای backdrop-filter / transform (مثل .card شیشه‌ای) برای position:fixed
 * «containing block» می‌سازد و پاپ‌آپ داخل همان کارت حبس می‌شود.
 */
export default function ModalPortal({ children }) {
  if (typeof document === 'undefined') return children;
  return createPortal(children, document.body);
}
