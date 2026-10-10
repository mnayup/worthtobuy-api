export function buildInvoiceWhereClause(query: any): any {
  const status = query.status && query.status !== 'ALL' ? String(query.status) : undefined;
  const billingModel =
    query.billing_model || query.billingModel
      ? String(query.billing_model || query.billingModel)
      : undefined;
  const overdue = String(query.overdue || '') === '1';
  const outstanding = String(query.outstanding || '') === '1';
  const search = String(query.search || '').trim().slice(0, 100);
  const customerId = query.customer_id ? Number(query.customer_id) : query.customerId ? Number(query.customerId) : undefined;
  const now = new Date();

  return {
    deleted_at: null,
    ...(status ? { status } : {}),
    ...(customerId ? { customer_id: customerId } : {}),
    ...(billingModel && billingModel !== 'ALL' ? { billing_model: billingModel } : {}),
    ...(overdue ? { due_date: { lt: now }, outstanding_amount: { gt: 0 } } : {}),
    ...(!overdue && outstanding ? { outstanding_amount: { gt: 0 } } : {}),
    ...(search
      ? {
        OR: [
          { invoice_number: { contains: search, mode: 'insensitive' as const } },
          { customer: { full_name: { contains: search, mode: 'insensitive' as const } } },
          { customer: { customer_code: { contains: search, mode: 'insensitive' as const } } },
          { customer: { whatsapp: { contains: search } } },
          { customer: { email: { contains: search, mode: 'insensitive' as const } } },
          { notes: { contains: search, mode: 'insensitive' as const } },
          { orders: { some: { order: { order_number: { contains: search, mode: 'insensitive' as const } } } } },
          { orders: { some: { order: { period: { code: { contains: search, mode: 'insensitive' as const } } } } } },
          { orders: { some: { order: { period: { name: { contains: search, mode: 'insensitive' as const } } } } } },
          { orders: { some: { order: { items: { some: { manual_product_name: { contains: search, mode: 'insensitive' as const } } } } } } },
          { orders: { some: { order: { items: { some: { product: { name: { contains: search, mode: 'insensitive' as const } } } } } } } },
        ],
      }
      : {}),
  };
}

export function buildAvailableOrdersWhereClause(query: any): any {
  const customerId = query.customer_id ? Number(query.customer_id) : query.customerId ? Number(query.customerId) : undefined;
  const orderId = query.order_id ? Number(query.order_id) : query.orderId ? Number(query.orderId) : undefined;
  const search = String(query.search || '').trim().slice(0, 100);

  return {
    deleted_at: null,
    ...(customerId ? { customer_id: customerId } : {}),
    ...(orderId ? { id: orderId } : {}),
    AND: [
      {
        OR: [
          { invoice_links: { none: {} } },
          { invoice_links: { every: { invoice: { invoice_number: { startsWith: 'WTB-LEGACY-' }, payments: { none: {} }, refunds: { none: {} } } } } },
        ],
      },
      ...(search
        ? [
          {
            OR: [
              { order_number: { contains: search, mode: 'insensitive' as const } },
              { period: { code: { contains: search, mode: 'insensitive' as const } } },
              { items: { some: { manual_product_name: { contains: search, mode: 'insensitive' as const } } } },
              { items: { some: { product: { name: { contains: search, mode: 'insensitive' as const } } } } },
            ],
          },
        ]
        : []),
    ],
    status: { notIn: ['CANCELLED'] },
  };
}
