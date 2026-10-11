export function calculateReadyStockValuation(readyStockProducts: any[]) {
  const readyStockTotalCapital = readyStockProducts.reduce(
    (sum, p) =>
      sum +
      Number(p.stock_quantity ?? p.stockQuantity ?? 0) *
        Number(p.buy_price ?? p.buyPrice ?? 0),
    0
  );
  const readyStockAvailableCapital = readyStockProducts.reduce(
    (sum, p) => {
      const stock = Number(p.stock_quantity ?? p.stockQuantity ?? 0);
      const reserved = Number(p.reserved_quantity ?? p.reservedQuantity ?? 0);
      return sum + Math.max(0, stock - reserved) * Number(p.buy_price ?? p.buyPrice ?? 0);
    },
    0
  );
  const readyStockPotentialSales = readyStockProducts.reduce(
    (sum, p) =>
      sum +
      Number(p.stock_quantity ?? p.stockQuantity ?? 0) *
        Number(p.selling_price ?? p.sellingPrice ?? 0),
    0
  );
  const readyStockPotentialProfit = readyStockPotentialSales - readyStockTotalCapital;
  const readyStockUnits = readyStockProducts.reduce(
    (sum, p) => sum + Number(p.stock_quantity ?? p.stockQuantity ?? 0),
    0
  );
  const readyStockAvailableUnits = readyStockProducts.reduce(
    (sum, p) => {
      const stock = Number(p.stock_quantity ?? p.stockQuantity ?? 0);
      const reserved = Number(p.reserved_quantity ?? p.reservedQuantity ?? 0);
      return sum + Math.max(0, stock - reserved);
    },
    0
  );

  const readyStockItems = readyStockProducts.slice(0, 50).map((p) => {
    const stock = Number(p.stock_quantity ?? p.stockQuantity ?? 0);
    const reserved = Number(p.reserved_quantity ?? p.reservedQuantity ?? 0);
    const buyPrice = Number(p.buy_price ?? p.buyPrice ?? 0);
    const sellingPrice = Number(p.selling_price ?? p.sellingPrice ?? 0);
    const available = Math.max(0, stock - reserved);

    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      brandName: p.brand_name || p.brandName || '-',
      brand_name: p.brand_name || p.brandName || '-',
      stockQuantity: stock,
      stock_quantity: stock,
      reservedQuantity: reserved,
      reserved_quantity: reserved,
      availableQuantity: available,
      available_quantity: available,
      buyPrice,
      buy_price: buyPrice,
      sellingPrice,
      selling_price: sellingPrice,
      totalCapitalValue: stock * buyPrice,
      totalPotentialSales: stock * sellingPrice,
      potentialProfit: (sellingPrice - buyPrice) * stock,
      marginPercent: sellingPrice > 0 ? ((sellingPrice - buyPrice) / sellingPrice) * 100 : 0,
    };
  });

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
    const subtotal = Number(order.subtotal_idr ?? order.productSubtotalIdr ?? 0);
    const serviceFee = Number(order.service_fee_amount ?? order.serviceFee ?? 0);
    const shipping = Number(
      order.customer_shipping_cost ??
        order.customerShipping ??
        order.shipping_cost ??
        order.localShipping ??
        0
    );
    const addFee = Number(order.additional_fee ?? order.additionalFee ?? 0);
    const discount = Number(order.discount_amount ?? order.discount ?? 0);

    goodsRevenue += subtotal * ratio;
    serviceFeeIncome += serviceFee * ratio;
    otherFeeIncome += (shipping + addFee) * ratio;
    discountTotal += discount * ratio;
  });

  return { goodsRevenue, serviceFeeIncome, otherFeeIncome, discountTotal };
}
