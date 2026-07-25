import Swal from 'sweetalert2';

const BASE = {
  heightAuto: false,
  buttonsStyling: true,
  reverseButtons: true,
  customClass: {
    container: 'app-swal-container',
    popup: 'swal2-rtl app-swal-popup',
    confirmButton: 'app-swal-confirm',
    cancelButton: 'app-swal-cancel',
  },
};

/**
 * تأییدهای حساس (حذف، فعال‌سازی، …) — فقط SweetAlert2
 */
export async function confirmAction({
  title,
  text,
  confirmText = 'تایید',
  icon = 'question',
} = {}) {
  const result = await Swal.fire({
    ...BASE,
    icon,
    title: title || 'تایید عملیات',
    text: text || '',
    showCancelButton: true,
    focusCancel: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'انصراف',
  });
  return result.isConfirmed;
}

/** هشدار مودال برای موارد نادر که نیاز به توقف کاربر دارد */
export async function showAlert({ title, text, icon = 'info' } = {}) {
  await Swal.fire({
    ...BASE,
    icon,
    title: title || 'پیام',
    text: text || '',
    confirmButtonText: 'باشه',
    showCancelButton: false,
  });
}
