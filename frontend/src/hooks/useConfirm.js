import Swal from 'sweetalert2';

export async function confirmAction({
  title,
  text,
  confirmText = 'تایید',
  icon = 'question',
} = {}) {
  const result = await Swal.fire({
    icon,
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'انصراف',
    customClass: { popup: 'swal2-rtl' },
  });
  return result.isConfirmed;
}

export async function showAlert({ title, text, icon = 'info' } = {}) {
  await Swal.fire({ icon, title, text, confirmButtonText: 'باشه', customClass: { popup: 'swal2-rtl' } });
}
