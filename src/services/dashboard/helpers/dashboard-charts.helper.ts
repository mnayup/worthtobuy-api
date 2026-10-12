export function buildDailyTrends(
  invoices: any[],
): Array<{ date: string; omzet: number; orders: number }> {
  const dailyMap = new Map<string, { date: string; omzet: number; orders: number }>();

  invoices.forEach((inv) => {
    const rawDate = inv.invoice_date || inv.created_at;
    const dateStr = rawDate instanceof Date
      ? rawDate.toISOString().split('T')[0]
      : String(rawDate).split('T')[0];

    const existing = dailyMap.get(dateStr) || { date: dateStr, omzet: 0, orders: 0 };
    existing.omzet += Number(inv.total_bill || 0);
    existing.orders += Array.isArray(inv.orders) ? inv.orders.length : 1;
    dailyMap.set(dateStr, existing);
  });

  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function buildTopProducts(
  orders: any[],
): Array<{ name: string; quantity: number }> {
  const productMap = new Map<string, number>();

  orders.forEach((order) => {
    if (!Array.isArray(order.items)) return;
    order.items.forEach((item: any) => {
      const name =
        item.manual_product_name ||
        item.product?.name ||
        `Item #${item.id}`;
      const qty = Number(item.quantity || 1);
      productMap.set(name, (productMap.get(name) || 0) + qty);
    });
  });

  return Array.from(productMap.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);
}

export function buildTopCustomers(
  orders: any[],
): Array<{ name: string; orders: number; omzet: number }> {
  const customerMap = new Map<string, { name: string; orders: number; omzet: number }>();

  orders.forEach((order) => {
    const name =
      order.customer?.full_name ||
      `Customer #${order.customer_id}`;
    const existing = customerMap.get(name) || { name, orders: 0, omzet: 0 };
    existing.orders += 1;
    existing.omzet += Number(order.total_bill || 0);
    customerMap.set(name, existing);
  });

  return Array.from(customerMap.values())
    .sort((a, b) => b.omzet - a.omzet)
    .slice(0, 5);
}
