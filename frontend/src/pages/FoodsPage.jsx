import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';
import { money } from '../utils/format';

export default function FoodsPage() {
  const { toast } = useToast();
  const [foods, setFoods] = useState([]);
  const [cart, setCart] = useState([]);

  useEffect(() => {
    api('/api/foods').then((d) => { if (d.success) setFoods(d.data || []); });
  }, []);

  function addToCart(food) {
    setCart((c) => {
      const existing = c.find((i) => i.foodId === food._id);
      if (existing) return c.map((i) => i.foodId === food._id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...c, { foodId: food._id, name: food.name, price: food.price, quantity: 1 }];
    });
    toast(`${food.name} به سبد اضافه شد`);
  }

  async function checkout() {
    if (!cart.length) return toast('سبد خرید خالی است', 'error');
    const data = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ items: cart.map((i) => ({ foodId: i.foodId, quantity: i.quantity })) }),
    });
    if (!data.success) return toast(data.message || 'خطا', 'error');
    toast('سفارش ثبت شد');
    setCart([]);
  }

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  return (
    <div style={{ maxWidth: 1200, margin: '30px auto', padding: '0 20px' }}>
      <div className="page-header">
        <div><div className="ph-title">فهرست غذای سازمان</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
        <div className="cart-summary">
          <div>سبد: {cart.length} آیتم — {money(total)}</div>
          <button type="button" className="btn btn-primary btn-w100 mt-2" onClick={checkout}>تکمیل سفارش</button>
        </div>
        <div className="menu-grid">
          {foods.map((f) => (
            <div key={f._id} className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 800 }}>{f.name}</div>
              <div>{money(f.price)}</div>
              <button type="button" className="btn btn-sm btn-primary mt-1" onClick={() => addToCart(f)}>افزودن</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
