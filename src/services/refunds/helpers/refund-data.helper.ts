function getField(body: any, snakeKey: string, camelKey: string) {
  return body[snakeKey] !== undefined ? body[snakeKey] : body[camelKey];
}

function parseTrimmedString(val: any, fallback?: string): string | undefined {
  if (val === undefined) return fallback;
  return val ? String(val).trim() : fallback;
}

function parseNumberId(val: any): number | null {
  return val ? Number(val) : null;
}

const ID_MAPPINGS: ReadonlyArray<readonly [string, string, string]> = [
  ['order_id', 'orderId', 'order_id'],
  ['invoice_id', 'invoiceId', 'invoice_id'],
  ['customer_id', 'customerId', 'customer_id'],
];

const TEXT_NULLABLE_MAPPINGS: ReadonlyArray<readonly [string, string, string]> = [
  ['bank_name', 'bankName', 'bank_name'],
  ['account_number', 'accountNumber', 'account_number'],
  ['account_holder', 'accountHolder', 'account_holder'],
  ['proof_url', 'proofUrl', 'proof_url'],
  ['transfer_notes', 'transferNotes', 'transfer_notes'],
];

function assignRefundIdentifiers(body: any, cleaned: any) {
  const refundNumberVal = getField(body, 'refund_number', 'refundNumber');
  if (refundNumberVal !== undefined) {
    cleaned.refund_number = parseTrimmedString(refundNumberVal);
  }

  for (const [snakeKey, camelKey, targetKey] of ID_MAPPINGS) {
    const val = getField(body, snakeKey, camelKey);
    if (val !== undefined) cleaned[targetKey] = parseNumberId(val);
  }
}

function assignRefundBankDetails(body: any, cleaned: any) {
  for (const [snakeKey, camelKey, targetKey] of TEXT_NULLABLE_MAPPINGS) {
    const val = getField(body, snakeKey, camelKey);
    if (val !== undefined) cleaned[targetKey] = parseTrimmedString(val, null as any);
  }
}

function assignRefundDirectFields(body: any, cleaned: any) {
  const refundTypeVal = getField(body, 'refund_type', 'refundType');
  if (refundTypeVal !== undefined) cleaned.refund_type = refundTypeVal;

  if (body.amount !== undefined) cleaned.amount = Number(body.amount);
  if (body.reason !== undefined) cleaned.reason = String(body.reason || '').trim();
  if (body.status !== undefined) cleaned.status = body.status;
  if (body.source !== undefined) cleaned.source = body.source;
  if (body.notes !== undefined) cleaned.notes = body.notes ? String(body.notes).trim() : null;

  const refundedAtVal = getField(body, 'refunded_at', 'refundedAt');
  if (refundedAtVal !== undefined) {
    cleaned.refunded_at = refundedAtVal ? new Date(refundedAtVal) : null;
  }
}

export function cleanRefundData(body: any): any {
  if (!body || typeof body !== 'object') return {};
  const cleaned: any = {};

  assignRefundIdentifiers(body, cleaned);
  assignRefundBankDetails(body, cleaned);
  assignRefundDirectFields(body, cleaned);

  return cleaned;
}

export function buildRefundWhereClause(query: any): any {
  const search = String(query.search || '').trim().slice(0, 100);
  const status = query.status && query.status !== 'ALL' ? String(query.status) : undefined;
  const source = query.source && query.source !== 'ALL' ? String(query.source) : undefined;
  const refund_type = query.refund_type && query.refund_type !== 'ALL' ? String(query.refund_type) : undefined;

  const searchFilter = search
    ? [
        {
          OR: [
            { refund_number: { contains: search, mode: 'insensitive' } },
            { reason: { contains: search, mode: 'insensitive' } },
            { invoice: { invoice_number: { contains: search, mode: 'insensitive' } } },
            { order: { order_number: { contains: search, mode: 'insensitive' } } },
            { invoice: { customer: { full_name: { contains: search, mode: 'insensitive' } } } },
            { order: { customer: { full_name: { contains: search, mode: 'insensitive' } } } },
            { customer: { full_name: { contains: search, mode: 'insensitive' } } },
            { invoice: { customer: { whatsapp: { contains: search } } } },
            { order: { customer: { whatsapp: { contains: search } } } },
            { customer: { whatsapp: { contains: search } } },
            { notes: { contains: search, mode: 'insensitive' } },
          ],
        },
      ]
    : [];

  return {
    deleted_at: null,
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(refund_type ? { refund_type } : {}),
    AND: [
      { OR: [{ order: { deleted_at: null } }, { invoice: { deleted_at: null } }] },
      ...searchFilter,
    ],
  };
}

const STATUS_PRIORITY: Record<string, number> = {
  REQUESTED: 1,
  ON_PROCESS: 2,
  APPROVED: 2,
  PAID: 3,
  REJECTED: 4,
};

export function sortRefundRows(rows: any[]): any[] {
  return [...rows].sort((a, b) => {
    const pA = STATUS_PRIORITY[a.status] || 99;
    const pB = STATUS_PRIORITY[b.status] || 99;
    if (pA !== pB) return pA - pB;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function resolveRefundTargets(current: any, cleaned: any) {
  const resolvedOrderId = cleaned.order_id === undefined ? current.order_id : cleaned.order_id || null;
  const resolvedInvoiceId = cleaned.invoice_id === undefined ? current.invoice_id : cleaned.invoice_id || null;
  const rawCustomerId = current.customer_id || current.order?.customer_id || current.invoice?.customer_id || null;
  const customerId = cleaned.customer_id ? Number(cleaned.customer_id) : rawCustomerId;

  return { resolvedOrderId, resolvedInvoiceId, customerId };
}

export function shouldValidateDepositRelease(current: any, cleaned: any): boolean {
  if (current.status !== 'PAID' || current.refund_type !== 'CUSTOMER_DEPOSIT') {
    return false;
  }
  const isRejected = cleaned.status === 'REJECTED';
  const isDifferentType = Boolean(cleaned.refund_type && cleaned.refund_type !== 'CUSTOMER_DEPOSIT');
  return isRejected || isDifferentType;
}

export function buildRefundUpdatePayload(current: any, cleaned: any, targets: {
  resolvedOrderId: number | null;
  resolvedInvoiceId: number | null;
  customerId: number | null;
}) {
  const isPaidAutoOverpayment = cleaned.status === 'PAID' && current.auto_generated && current.source === 'OVERPAYMENT';
  const shouldSetDefaultRefundedAt = cleaned.status === 'PAID' && !cleaned.refunded_at;
  const refundedAt = shouldSetDefaultRefundedAt ? new Date() : cleaned.refunded_at;

  return {
    ...cleaned,
    order_id: cleaned.order_id === undefined ? undefined : targets.resolvedOrderId,
    invoice_id: cleaned.invoice_id === undefined ? undefined : targets.resolvedInvoiceId,
    customer_id: targets.customerId || undefined,
    refund_type: cleaned.refund_type !== undefined ? cleaned.refund_type : undefined,
    refunded_at: refundedAt,
    ...(isPaidAutoOverpayment ? { source_key: null } : {}),
  };
}


