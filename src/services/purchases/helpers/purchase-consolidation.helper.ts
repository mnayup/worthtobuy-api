export function formatConsolidatedPurchase(purchases: any[]): any {
  if (!purchases || purchases.length === 0) return null;

  const primary = purchases[0];
  const items = purchases.map((p) => {
    const item = p.order_item || {};
    const order = item.order || {};
    const customer = order.customer || {};

    const isPriorityCustomer = customer.segment === 'PRIORITY';
    const paidAmount = Number(order.paid_amount || 0);
    const hasPaidDp =
      paidAmount > 0 ||
      ['DP_RECEIVED', 'WAITING_PURCHASE', 'WAITING_SETTLEMENT', 'PAID'].includes(order.status);
    const isEligibleToBuy = isPriorityCustomer || hasPaidDp;

    const productName =
      p.product?.name || item.product?.name || item.manual_product_name || 'Item';

    return {
      id: p.id,
      purchase_id: p.id,
      order_item_id: p.order_item_id,
      order_id: order.id,
      order_number: order.order_number || `ORD-${order.id}`,
      customer_id: customer.id,
      customer_name: customer.full_name || 'Customer',
      customer_whatsapp: customer.whatsapp || '',
      customer_segment: customer.segment || 'REGULAR',
      is_priority_customer: isPriorityCustomer,
      order_status: order.status || 'NEW',
      order_paid_amount: paidAmount,
      order_total_bill: Number(order.total_bill || 0),
      order_outstanding_amount: Number(order.outstanding_amount || 0),
      has_paid_dp: hasPaidDp,
      is_eligible_to_buy: isEligibleToBuy,
      product_id: p.product_id,
      product_name: productName,
      brand_name: p.brand_name || item.brand_name || '-',
      variation: item.variation || null,
      size: item.size || null,
      color: item.color || null,
      quantity: Number(p.quantity || 1),
      estimated_price: Number(p.estimated_price || 0),
      actual_price: Number(p.actual_price || 0),
      price_difference: Number(p.price_difference || 0),
      status: p.status,
      fulfillment_status: item.fulfillment_status || 'PENDING',
      purchase_status: item.purchase_status || 'PENDING',
    };
  });

  const totalQuantity = items.reduce((sum, it) => sum + it.quantity, 0);
  const eligibleQuantity = items.filter((it) => it.is_eligible_to_buy).reduce(
    (sum, it) => sum + it.quantity,
    0
  );
  const totalEstimatedPrice = items.reduce((sum, it) => sum + it.estimated_price, 0);
  const totalActualPrice = items.reduce((sum, it) => sum + it.actual_price, 0);

  // Group status
  const allPurchased = items.every((it) => it.status === 'PURCHASED');
  const allUnavailable = items.every((it) => it.status === 'UNAVAILABLE');
  const anyPurchased = items.some((it) => it.status === 'PURCHASED');
  const groupStatus = allPurchased
    ? 'PURCHASED'
    : allUnavailable
      ? 'UNAVAILABLE'
      : anyPurchased
        ? 'PARTIAL'
        : 'WAITING_PURCHASE';

  // Product summary label
  const distinctNames = Array.from(new Set(items.map((i) => i.product_name)));
  const productSummary =
    distinctNames.length === 1
      ? items.length > 1
        ? `${distinctNames[0]} (${items.length} items/variants)`
        : distinctNames[0]
      : `${distinctNames[0]} + ${distinctNames.length - 1} other items`;

  return {
    id: primary.id,
    purchase_number: primary.purchase_number,
    purchaseNumber: primary.purchase_number,
    batch_number: primary.batch_number || 1,
    batchNumber: primary.batch_number || 1,
    purchase_date: primary.purchase_date,
    purchaseDate: primary.purchase_date,
    period_id: primary.period_id,
    period: primary.period,
    shopper_id: primary.shopper_id,
    shopper: primary.shopper,
    brand_name: primary.brand_name,
    brandName: primary.brand_name,
    status: groupStatus,
    product_summary: productSummary,
    product: { name: productSummary },
    items,
    quantity: totalQuantity,
    totalQuantity,
    eligibleQuantity,
    estimated_price: totalEstimatedPrice,
    estimatedPrice: totalEstimatedPrice,
    actual_price: totalActualPrice,
    actualPrice: totalActualPrice,
    price_difference: totalActualPrice - totalEstimatedPrice,
    priceDifference: totalActualPrice - totalEstimatedPrice,
    payment_method: primary.payment_method,
    paymentMethod: primary.payment_method,
    receipt_url: primary.receipt_url,
    receiptUrl: primary.receipt_url,
    notes: primary.notes,
  };
}

export function groupPurchasesByNumber(purchases: any[]): any[] {
  const map = new Map<string, any[]>();
  for (const p of purchases) {
    const num = p.purchase_number || String(p.id);
    if (!map.has(num)) map.set(num, []);
    map.get(num)!.push(p);
  }

  const result: any[] = [];
  for (const group of map.values()) {
    const formatted = formatConsolidatedPurchase(group);
    if (formatted) result.push(formatted);
  }
  return result;
}
