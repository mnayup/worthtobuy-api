export function aggregatePeriodPerformance(
  periods: any[],
  invoices: any[],
  purchases: any[],
  expenses: any[]
) {
  const omzetByPeriod = new Map<number, number>();
  const goodsRevenueByPeriod = new Map<number, number>();
  const serviceFeeByPeriod = new Map<number, number>();
  const orderIdsByPeriod = new Map<number, Set<number>>();

  invoices.forEach((invoice) =>
    invoice.orders.forEach((link: any) => {
      const periodId = link.order?.period_id ?? link.order?.periodId;
      if (periodId !== undefined && periodId !== null) {
        const currentOmzet = omzetByPeriod.get(periodId) || 0;
        omzetByPeriod.set(periodId, currentOmzet + Number(link.snapshot_amount ?? link.snapshotAmount ?? 0));

        const currentGoods = goodsRevenueByPeriod.get(periodId) || 0;
        goodsRevenueByPeriod.set(
          periodId,
          currentGoods + Number(link.order?.subtotal_idr ?? link.order?.productSubtotalIdr ?? 0)
        );

        const currentFee = serviceFeeByPeriod.get(periodId) || 0;
        serviceFeeByPeriod.set(
          periodId,
          currentFee + Number(link.order?.service_fee_amount ?? link.order?.serviceFee ?? 0)
        );

        const ids = orderIdsByPeriod.get(periodId) || new Set<number>();
        const orderId = link.order_id ?? link.orderId;
        if (orderId) ids.add(orderId);
        orderIdsByPeriod.set(periodId, ids);
      }
    })
  );

  const modalByPeriod = new Map<number, number>();
  const estimatedModalByPeriod = new Map<number, number>();

  purchases.forEach((purchase) => {
    const period = purchase.order_item?.order?.period_id ?? purchase.orderItem?.order?.periodId;
    if (period !== undefined && period !== null) {
      modalByPeriod.set(
        period,
        (modalByPeriod.get(period) || 0) + Number(purchase.actual_price ?? purchase.actualPrice ?? 0)
      );
      estimatedModalByPeriod.set(
        period,
        (estimatedModalByPeriod.get(period) || 0) +
          Number(
            purchase.estimated_price ??
              purchase.estimatedPrice ??
              purchase.actual_price ??
              purchase.actualPrice ??
              0
          )
      );
    }
  });

  const expensesByPeriod = new Map<number, number>();
  expenses.forEach((expense) => {
    const expPeriodId = expense.period_id ?? expense.periodId;
    if (!expPeriodId) return;
    expensesByPeriod.set(
      expPeriodId,
      (expensesByPeriod.get(expPeriodId) || 0) + Number(expense.amount_idr ?? expense.amountIdr ?? 0)
    );
  });

  return periods.map((period) => {
    const omzet = omzetByPeriod.get(period.id) || 0;
    const modal = modalByPeriod.get(period.id) || 0;
    const estimatedBuyPrice = estimatedModalByPeriod.get(period.id) || 0;
    const periodExpenses = expensesByPeriod.get(period.id) || 0;
    const goodsRev = goodsRevenueByPeriod.get(period.id) || 0;
    const feeIncome = serviceFeeByPeriod.get(period.id) || 0;
    const shoppingVariance = estimatedBuyPrice - modal;
    const netProfit = omzet - modal - periodExpenses;

    return {
      id: period.id,
      code: period.code,
      name: period.name,
      location: period.city || 'Indonesia',
      orders: orderIdsByPeriod.get(period.id)?.size || 0,
      omzet,
      goodsRevenue: goodsRev,
      serviceFeeIncome: feeIncome,
      estimatedBuyPrice,
      modal,
      actualBuyPrice: modal,
      shoppingVariance,
      expenses: periodExpenses,
      netProfit,
      margin: omzet ? (netProfit / omzet) * 100 : 0,
    };
  });
}
