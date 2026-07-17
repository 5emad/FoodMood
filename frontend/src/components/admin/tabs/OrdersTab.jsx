import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import SearchGroup from '../shared/SearchGroup';
import Pagination from '../shared/Pagination';
import AdminSpinner from '../shared/AdminSpinner';
import TableActions from '../shared/TableActions';
import { jdate, money } from '../../../utils/format';

const STATUS = { pending: 'قابل لغو', confirmed: 'تایید شده', ready: 'آماده', completed: 'تحویل شده', cancelled: 'لغو شده' };
const STATUS_CLASS = { pending: 'warning', confirmed: 'primary', ready: 'success', completed: 'success', cancelled: 'danger' };

export default function OrdersTab({ onReportsAccessChange }) {
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, totalPages: 1, total: 0 });

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) params.set('orderNumber', search.trim());
    const data = await api(`/api/orders/admin/all?${params}`);
    setOrders(data.success ? data.data : []);
    setPagination(data.pagination || { page, limit: 20, totalPages: 1, total: 0 });
    setLoading(false);
  }, [search]);

  useEffect(() => { load(1); }, [load]);

  async function confirmAll() {
    if (!(await confirmAction({ title: 'تایید همه سفارش‌های در انتظار؟', confirmText: 'تایید همه', icon: 'question' }))) return;
    const data = await api('/api/orders/admin/confirm-week', { method: 'POST', body: JSON.stringify({ scope: 'all' }) });
    if (data.success) {
      toast(data.message || 'سفارش‌ها تایید شدند', 'success');
      load(pagination.page);
      onReportsAccessChange?.();
    } else toast(data.message || 'خطا', 'error');
  }

  async function cancelOrder(orderNumber) {
    if (!(await confirmAction({ title: `لغو سفارش #${orderNumber}؟`, text: 'ظرفیت رزرو آزاد می‌شود.', confirmText: 'لغو سفارش', icon: 'warning' }))) return;
    const data = await api(`/api/orders/admin/${encodeURIComponent(orderNumber)}/cancel`, { method: 'POST' });
    if (data.success) { toast('سفارش لغو شد', 'success'); load(pagination.page); }
    else toast(data.message || 'خطا', 'error');
  }

  return (
    <section id="tab-orders" className="tab-pane active">
      <SectionHeader
        title="سفارش‌ها"
        sub="پس از بررسی، همه سفارش‌های در انتظار را تایید کنید تا گزارش‌ها باز شود."
        actions={(
          <div className="order-toolbar">
            <SearchGroup
              type="number"
              min={100}
              placeholder="کد سفارش"
              value={search}
              onChange={setSearch}
              onSearch={() => load(1)}
              onClear={() => { setSearch(''); load(1); }}
            />
            <button type="button" className="btn btn-success btn-confirm-week" onClick={confirmAll}>
              <i className="fas fa-check-double" /> تایید همه سفارش‌های در انتظار
            </button>
          </div>
        )}
      />
      <div className="table-wrap" id="ordersWrap">
        {loading ? <AdminSpinner /> : (
          <>
            <table className="table">
              <thead><tr><th>کد</th><th>نام مشتری</th><th>غذا</th><th>مبلغ</th><th>وضعیت</th><th>تاریخ</th><th>عملیات</th></tr></thead>
              <tbody>
                {orders.length ? orders.map((o) => (
                  <tr key={o._id}>
                    <td style={{ fontWeight: 900, direction: 'ltr' }}>#{o.orderNumber || '-'}</td>
                    <td style={{ fontWeight: 700 }}>{o.userId?.fullName || o.userId?.username || o.orderUserName || o.ldapUsername || '-'}</td>
                    <td>{o.menuItemId?.foodId?.name || o.items?.[0]?.foodId?.name || '-'}</td>
                    <td>{money(o.totalPrice)}</td>
                    <td><span className={`badge badge-${STATUS_CLASS[o.status] || 'gray'}`}>{STATUS[o.status] || o.status}</span></td>
                    <td>{jdate(o.orderDate)}</td>
                    <TableActions>
                      {o.status !== 'cancelled' ? (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => cancelOrder(o.orderNumber || o._id)}><i className="fas fa-ban" /> لغو</button>
                      ) : <span className="badge badge-gray">لغو شده</span>}
                    </TableActions>
                  </tr>
                )) : <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>سفارشی ثبت نشده</td></tr>}
              </tbody>
            </table>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPage={load} />
          </>
        )}
      </div>
    </section>
  );
}
