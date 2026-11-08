const SORTING_MARKER_START = '<!--SORTING_DATA:';
const SORTING_MARKER_END = '-->';

export function extractSortingFromNotes(rawNotes?: string | null): {
  cleanNotes: string | null;
  sortingLines: any[];
} {
  if (!rawNotes) return { cleanNotes: null, sortingLines: [] };
  const str = String(rawNotes);
  const startIdx = str.indexOf(SORTING_MARKER_START);
  if (startIdx === -1) {
    return { cleanNotes: str.trim() || null, sortingLines: [] };
  }
  const endIdx = str.indexOf(SORTING_MARKER_END, startIdx + SORTING_MARKER_START.length);
  if (endIdx === -1) {
    return { cleanNotes: str.trim() || null, sortingLines: [] };
  }

  const jsonPart = str.slice(startIdx + SORTING_MARKER_START.length, endIdx).trim();
  const cleanPart = (str.slice(0, startIdx) + str.slice(endIdx + SORTING_MARKER_END.length)).trim();

  let sortingLines: any[] = [];
  try {
    const parsed = JSON.parse(jsonPart);
    if (Array.isArray(parsed)) sortingLines = parsed;
  } catch {
    sortingLines = [];
  }

  return {
    cleanNotes: cleanPart || null,
    sortingLines,
  };
}

export function embedSortingIntoNotes(
  userNotes: string | null | undefined,
  sortingLines?: any[] | null
): string | null {
  const { cleanNotes } = extractSortingFromNotes(userNotes);
  const hasLines = Array.isArray(sortingLines) && sortingLines.length > 0;
  if (!hasLines) return cleanNotes;
  const serialized = `${SORTING_MARKER_START}${JSON.stringify(sortingLines)}${SORTING_MARKER_END}`;
  return cleanNotes ? `${cleanNotes}\n${serialized}` : serialized;
}

export function formatConsolidatedPurchase(purchases: any[]): any {
  if (!purchases || purchases.length === 0) return null;

  const primary = purchases[0];
  let sortingLines: any[] = [];
  let cleanPrimaryNotes: string | null = null;

  for (const p of purchases) {
    const extracted = extractSortingFromNotes(p.notes);
    if (cleanPrimaryNotes === null && extracted.cleanNotes) {
      cleanPrimaryNotes = extracted.cleanNotes;
    }
    if (sortingLines.length === 0 && extracted.sortingLines.length > 0) {
      sortingLines = extracted.sortingLines;
    }
  }

  const items = purchases.map((p) => {
    const isManualPurchase = !p.order_item_id;
    const item = p.order_item || {};
    const order = item.order || {};
    const customer = order.customer || {};

    const isPriorityCustomer = isManualPurchase ? true : customer.segment === 'PRIORITY';
    const invoiceLinks = Array.isArray(order.invoice_links) ? order.invoice_links : [];
    const activeInvoices = invoiceLinks
      .map((l: any) => l.invoice)
      .filter((inv: any) => inv && !inv.deleted_at && inv.status !== 'CANCELLED');
    const invoicePaidAmount = activeInvoices.reduce(
      (sum: number, inv: any) =>
        sum + Number(inv.paid_amount || 0) + Number(inv.deposit_amount || 0),
      0
    );
    const paidAmount = Number(order.paid_amount || 0);
    const hasPaidDp =
      isManualPurchase ||
      (activeInvoices.length > 0 && invoicePaidAmount > 0 && paidAmount > 0) ||
      (paidAmount > 0 && !['NEW', 'WAITING_DP'].includes(order.status)) ||
      ['DP_RECEIVED', 'PAID'].includes(order.status);
    const isEligibleToBuy = isPriorityCustomer || hasPaidDp;

    const productName =
      p.product?.name || item.product?.name || item.manual_product_name || 'Item';

    const rawProdVariants = p.product?.variant || item.product?.variant || '';
    const rawProdSizes = p.product?.size || item.product?.size || '';
    const parseList = (str: string) =>
      String(str || '')
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

    return {
      id: p.id,
      purchase_id: p.id,
      order_item_id: p.order_item_id,
      order_id: order.id || null,
      order_number: isManualPurchase
        ? 'LIVE-SHOPPING'
        : order.order_number || `ORD-${order.id}`,
      customer_id: customer.id || null,
      customer_name: isManualPurchase
        ? 'Live Shopping Stock'
        : customer.full_name || 'Customer',
      customer_whatsapp: customer.whatsapp || '',
      customer_segment: isManualPurchase ? 'PRIORITY' : customer.segment || 'REGULAR',
      is_priority_customer: isPriorityCustomer,
      order_status: isManualPurchase ? 'PURCHASED' : order.status || 'NEW',
      order_paid_amount: paidAmount,
      order_total_bill: Number(order.total_bill || 0),
      order_outstanding_amount: Number(order.outstanding_amount || 0),
      has_paid_dp: hasPaidDp,
      is_eligible_to_buy: isEligibleToBuy,
      product_id: p.product_id || item.product_id || null,
      product_name: productName,
      product_variants: parseList(rawProdVariants),
      product_sizes: parseList(rawProdSizes),
      brand_name: p.brand_name || item.brand_name || '-',
      variation: p.variation || item.variation || p.product?.variant || null,
      size: p.size || item.size || p.product?.size || null,
      color: item.color || null,
      quantity: Number(p.quantity || 1),
      estimated_price: Number(p.estimated_price || 0),
      actual_price: Number(p.actual_price || 0),
      price_difference: Number(p.price_difference || 0),
      status: p.status,
      fulfillment_status: isManualPurchase
        ? p.status === 'PURCHASED'
          ? 'AVAILABLE'
          : 'PENDING'
        : item.fulfillment_status || 'PENDING',
      purchase_status: isManualPurchase
        ? p.status
        : item.purchase_status || 'PENDING',
      kept_until: item.kept_until || null,
    };
  });

  const totalQuantity = items.reduce((sum, it) => sum + it.quantity, 0);
  const eligibleQuantity = items.filter((it) => it.is_eligible_to_buy).reduce(
    (sum, it) => sum + it.quantity,
    0
  );
  const totalEstimatedPrice = items.reduce((sum, it) => sum + it.estimated_price, 0);
  const rawTotalActualPrice = items.reduce((sum, it) => sum + it.actual_price, 0);

  // Group status
  const allPurchased = items.every((it) => it.status === 'PURCHASED');
  const allUnavailable = items.every((it) => it.status === 'UNAVAILABLE');
  const anySorting = items.some((it) => it.status === 'SORTING');
  const anyPurchased = items.some((it) => it.status === 'PURCHASED');
  const groupStatus = allPurchased
    ? 'PURCHASED'
    : allUnavailable
      ? 'UNAVAILABLE'
      : anySorting
        ? 'SORTING'
        : anyPurchased
          ? 'PARTIAL'
          : 'WAITING_PURCHASE';

  const sortedActualPrice =
    sortingLines.length > 0
      ? sortingLines.reduce(
          (sum, l) => sum + Math.max(0, Number(l.actualQty || 0)) * Math.max(0, Number(l.unitPrice || 0)),
          0
        )
      : rawTotalActualPrice;

  const totalActualPrice =
    groupStatus === 'SORTING' && sortingLines.length > 0
      ? sortedActualPrice
      : rawTotalActualPrice;

  // Only count estimated price and difference on bought items (or sorted items when in SORTING)
  const purchasedItems = items.filter((it) => it.status === 'PURCHASED');
  const boughtEstimatedPrice = purchasedItems.reduce((sum, it) => sum + it.estimated_price, 0);
  const boughtActualPrice = purchasedItems.reduce((sum, it) => sum + it.actual_price, 0);
  const priceDifference =
    groupStatus === 'SORTING' && sortingLines.length > 0
      ? sortedActualPrice - totalEstimatedPrice
      : boughtActualPrice - boughtEstimatedPrice;

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
    sorting_lines: sortingLines,
    sortingLines,
    quantity: totalQuantity,
    totalQuantity,
    eligibleQuantity,
    estimated_price: totalEstimatedPrice,
    estimatedPrice: totalEstimatedPrice,
    actual_price: totalActualPrice,
    actualPrice: totalActualPrice,
    price_difference: priceDifference,
    priceDifference: priceDifference,
    payment_method: primary.payment_method,
    paymentMethod: primary.payment_method,
    receipt_url: primary.receipt_url,
    receiptUrl: primary.receipt_url,
    notes: cleanPrimaryNotes,
  };
}

export function groupPurchasesByNumber(purchases: any[]): any[] {
  const map = new Map<string, any[]>();
  for (const p of purchases) {
    const key =
      p.purchase_number ||
      (p.period_id ? `EVENT_${p.period_id}_WAITING` : String(p.id));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  const result: any[] = [];
  for (const group of map.values()) {
    const formatted = formatConsolidatedPurchase(group);
    if (formatted) result.push(formatted);
  }
  return result;
}
