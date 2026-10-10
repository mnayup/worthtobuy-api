export function buildOrdersWhereClause(query: any): any {
  const search = String(query.search || '').trim().slice(0, 100);
  const status = query.status ? String(query.status) : undefined;
  const periodId = query.period_id ? Number(query.period_id) : query.periodId ? Number(query.periodId) : undefined;
  const customerId = query.customer_id ? Number(query.customer_id) : query.customerId ? Number(query.customerId) : undefined;
  const uninvoiced = String(query.uninvoiced || '') === '1';
  const feeMode =
    query.service_fee_mode || query.serviceFeeMode || query.fee_mode || query.feeMode
      ? String(query.service_fee_mode || query.serviceFeeMode || query.fee_mode || query.feeMode)
      : undefined;

  return {
    deleted_at: null,
    ...(status ? { status } : {}),
    ...(periodId ? { period_id: periodId } : {}),
    ...(customerId ? { customer_id: customerId } : {}),
    ...(uninvoiced ? { invoice_links: { none: {} } } : {}),
    ...(feeMode && feeMode !== 'ALL' ? { service_fee_mode: feeMode } : {}),
    ...(search
      ? {
        OR: [
          { order_number: { contains: search, mode: 'insensitive' as const } },
          { customer: { full_name: { contains: search, mode: 'insensitive' as const } } },
          { customer: { customer_code: { contains: search, mode: 'insensitive' as const } } },
          { customer: { whatsapp: { contains: search } } },
          { customer: { email: { contains: search, mode: 'insensitive' as const } } },
          { period: { code: { contains: search, mode: 'insensitive' as const } } },
          { period: { name: { contains: search, mode: 'insensitive' as const } } },
          { admin: { name: { contains: search, mode: 'insensitive' as const } } },
          { customer_notes: { contains: search, mode: 'insensitive' as const } },
          { internal_notes: { contains: search, mode: 'insensitive' as const } },
          { items: { some: { manual_product_name: { contains: search, mode: 'insensitive' as const } } } },
          { items: { some: { brand_name: { contains: search, mode: 'insensitive' as const } } } },
          { items: { some: { variation: { contains: search, mode: 'insensitive' as const } } } },
          { items: { some: { size: { contains: search, mode: 'insensitive' as const } } } },
          { items: { some: { color: { contains: search, mode: 'insensitive' as const } } } },
          { items: { some: { product: { name: { contains: search, mode: 'insensitive' as const } } } } },
          { items: { some: { product: { sku: { contains: search, mode: 'insensitive' as const } } } } },
          { items: { some: { product: { brand_name: { contains: search, mode: 'insensitive' as const } } } } },
        ],
      }
      : {}),
  };
}
