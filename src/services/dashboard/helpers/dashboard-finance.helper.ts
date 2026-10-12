export function calculateInvoiceScopes(invoices: any[], period_id?: number) {
  return invoices
    .map((invoice) => {
      const total_bill = Number(invoice.total_bill);
      const scopedBill = period_id
        ? invoice.orders.reduce(
            (sum: number, link: any) => sum + Number(link.snapshot_amount),
            0,
          )
        : total_bill;
      const ratio = total_bill > 0 ? Math.min(1, scopedBill / total_bill) : 0;
      return {
        invoice,
        scopedBill,
        ratio,
        scopedOutstanding: Number(invoice.outstanding_amount) * ratio,
      };
    })
    .filter((scope) => scope.scopedBill > 0);
}

export function calculatePaymentsAndRefunds(
  allPayments: any[],
  allRefunds: any[],
  invoiceScopes: any[],
) {
  const activeInvoiceIds = new Set<number>(
    invoiceScopes.map((scope) => Number(scope.invoice.id)),
  );
  const invoiceRatioById = new Map<number, number>(
    invoiceScopes.map((scope) => [
      Number(scope.invoice.id),
      Number(scope.ratio),
    ]),
  );
  const financialOrders = invoiceScopes.flatMap((scope) =>
    scope.invoice.orders.map((link: any) => link.order),
  );
  const financialOrderIds = new Set<number>(
    financialOrders.map((order: any) => Number(order.id)),
  );

  const payments: Array<{ method: string; scopedAmount: number }> = [];
  allPayments.forEach((payment) => {
    if (
      payment.invoice_id &&
      activeInvoiceIds.has(Number(payment.invoice_id))
    ) {
      payments.push({
        method: payment.method,
        scopedAmount:
          Number(payment.amount) *
          (invoiceRatioById.get(Number(payment.invoice_id)) || 0),
      });
    } else if (
      payment.order_id &&
      financialOrderIds.has(Number(payment.order_id))
    ) {
      payments.push({
        method: payment.method,
        scopedAmount: Number(payment.amount),
      });
    }
  });

  const refunds: Array<{ scopedAmount: number }> = [];
  allRefunds.forEach((refund) => {
    if (
      refund.invoice_id &&
      activeInvoiceIds.has(Number(refund.invoice_id))
    ) {
      refunds.push({
        scopedAmount:
          Number(refund.amount) *
          (invoiceRatioById.get(Number(refund.invoice_id)) || 0),
      });
    } else if (
      refund.order_id &&
      financialOrderIds.has(Number(refund.order_id))
    ) {
      refunds.push({ scopedAmount: Number(refund.amount) });
    }
  });

  return {
    payments,
    refunds,
    financialOrders,
    financialOrderIds,
  };
}
