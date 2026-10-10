export function calculateReadyStockValuation(readyStockProducts: any[]) {
  const readyStockTotalCapital = readyStockProducts.reduce(
    (sum, p) => sum + p.stockQuantity * Number(p.buyPrice || 0),
    0
  );
  const readyStockAvailableCapital = readyStockProducts.reduce(
    (sum, p) => sum + Math.max(0, p.stockQuantity - p.reservedQuantity) * Number(p.buyPrice || 0),
    0
  );
  const readyStockPotentialSales = readyStockProducts.reduce(
    (sum, p) => sum + p.stockQuantity * Number(p.sellingPrice || 0),
    0
  );
  const readyStockPotentialProfit = readyStockPotentialSales - readyStockTotalCapital;
  const readyStockUnits = readyStockProducts.reduce((sum, p) => sum + p.stockQuantity, 0);
  const readyStockAvailableUnits = readyStockProducts.reduce(
    (sum, p) => sum + Math.max(0, p.stockQuantity - p.reservedQuantity),
    0
  );

  const readyStockItems = readyStockProducts.slice(0, 50).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    brandName: p.brandName || '-',
    stockQuantity: p.stockQuantity,
    reservedQuantity: p.reservedQuantity,
    availableQuantity: Math.max(0, p.stockQuantity - p.reservedQuantity),
    buyPrice: Number(p.buyPrice || 0),
    sellingPrice: Number(p.sellingPrice || 0),
    totalCapitalValue: p.stockQuantity * Number(p.buyPrice || 0),
    totalPotentialSales: p.stockQuantity * Number(p.sellingPrice || 0),
    potentialProfit: (Number(p.sellingPrice || 0) - Number(p.buyPrice || 0)) * p.stockQuantity,
    marginPercent:
      Number(p.sellingPrice) > 0
        ? ((Number(p.sellingPrice) - Number(p.buyPrice)) / Number(p.sellingPrice)) * 100
        : 0,
  }));

  return {
    totalCapitalValue: readyStockTotalCapital,
    availableCapitalValue: readyStockAvailableCapital,
    totalPotentialSales: readyStockPotentialSales,
    potentialGrossProfit: readyStockPotentialProfit,
    potentialMargin:
      readyStockPotentialSales > 0 ? (readyStockPotentialProfit / readyStockPotentialSales) * 100 : 0,
    totalUnits: readyStockUnits,
    availableUnits: readyStockAvailableUnits,
    skuCount: readyStockProducts.length,
    items: readyStockItems,
  };
}

export function computeFinancialOrderTotals(financialOrders: Array<{ order: any; ratio: number }>) {
  let goodsRevenue = 0;
  let serviceFeeIncome = 0;
  let otherFeeIncome = 0;
  let discountTotal = 0;

  financialOrders.forEach(({ order, ratio }) => {
    goodsRevenue += Number(order.productSubtotalIdr || 0) * ratio;
    serviceFeeIncome += Number(order.serviceFee || 0) * ratio;
    otherFeeIncome +=
      (Number(order.customerShipping || 0) +
        Number(order.localShipping || 0) +
        Number(order.internationalShipping || 0) +
        Number(order.additionalFee || 0)) *
      ratio;
    discountTotal += Number(order.discount || 0) * ratio;
  });

  return { goodsRevenue, serviceFeeIncome, otherFeeIncome, discountTotal };
}
