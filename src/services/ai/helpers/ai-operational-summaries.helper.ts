import { PrismaService } from '../../../config/prisma/prisma.service';
import { serializeData as serialize } from '../../../common/interceptors/serialize.interceptor';
import { DateWindow, TOP_LIMIT } from './ai-planner.helper';
import { dateWhere } from './ai-financial-summaries.helper';

const prisma = new PrismaService();

export async function customerIntelligence(window: DateWindow) {
  const invoice_date = dateWhere(window);
  const ranking = await prisma.invoice.groupBy({
    by: ['customer_id'],
    where: { deleted_at: null, status: { not: 'CANCELLED' }, ...(invoice_date ? { invoice_date } : {}) },
    _sum: { total_bill: true },
    _count: { _all: true },
    orderBy: { _sum: { total_bill: 'desc' } },
    take: TOP_LIMIT,
  });
  const ids = ranking.map((row) => row.customer_id);
  if (!ids.length) {
    return { period: window.label, ranking: [], clvDefinition: 'CLV operasional = total nilai invoice aktif sepanjang riwayat customer.' };
  }
  const [customers, orderFrequency, lifetime] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: ids }, deleted_at: null }, select: { id: true, customer_code: true, full_name: true, segment: true, joined_at: true } }),
    prisma.order.groupBy({ by: ['customer_id'], where: { deleted_at: null, customer_id: { in: ids }, ...(invoice_date ? { order_date: invoice_date } : {}) }, _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ['customer_id'], where: { deleted_at: null, status: { not: 'CANCELLED' }, customer_id: { in: ids } }, _sum: { total_bill: true }, _count: { _all: true } }),
  ]);
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const frequencyMap = new Map(orderFrequency.map((r) => [r.customer_id, r._count._all]));
  const lifetimeMap = new Map(lifetime.map((r) => [r.customer_id, { value: Number(r._sum.total_bill || 0), invoices: r._count._all }]));
  return serialize({
    period: window.label,
    clvDefinition: 'CLV operasional = total nilai invoice aktif sepanjang riwayat customer; belum memakai prediksi churn atau biaya akuisisi.',
    ranking: ranking.map((row, index) => {
      const customer = customerMap.get(row.customer_id);
      const clv = lifetimeMap.get(row.customer_id);
      return {
        rank: index + 1,
        customer_code: customer?.customer_code,
        customer: customer?.full_name,
        segment: customer?.segment,
        joined_at: customer?.joined_at,
        periodTransactionValue: Number(row._sum.total_bill || 0),
        periodInvoiceCount: row._count._all,
        periodOrderFrequency: frequencyMap.get(row.customer_id) || 0,
        customerLifetimeValue: clv?.value || 0,
        lifetimeInvoiceCount: clv?.invoices || 0,
      };
    }),
  });
}

export async function productIntelligence(window: DateWindow) {
  const order_date = dateWhere(window);
  const items = await prisma.order_item.findMany({
    where: { order: { deleted_at: null, status: { not: 'CANCELLED' }, ...(order_date ? { order_date } : {}) } },
    select: {
      product_id: true,
      manual_product_name: true,
      brand_name: true,
      quantity: true,
      target_price_idr: true,
      product: { select: { sku: true, name: true, category: true, brand_name: true } },
      purchases: { select: { actual_price: true } },
      order: { select: { period: { select: { code: true, name: true } } } },
    },
  });
  const grouped = new Map<string, any>();
  for (const item of items) {
    const name = item.product?.name || item.manual_product_name || 'Produk tanpa nama';
    const brand = item.product?.brand_name || item.brand_name || '-';
    const key = item.product_id ? `product:${item.product_id}` : `manual:${name.toLowerCase()}|${brand.toLowerCase()}`;
    const current = grouped.get(key) || {
      sku: item.product?.sku || null,
      name,
      brand,
      category: item.product?.category || null,
      quantity: 0,
      orderLines: 0,
      revenue: 0,
      purchaseCost: 0,
      events: new Set<string>(),
    };
    current.quantity += item.quantity;
    current.orderLines += 1;
    current.revenue += Number(item.target_price_idr) * item.quantity;
    current.purchaseCost += item.purchases.reduce((sum, purchase) => sum + Number(purchase.actual_price), 0);
    current.events.add(`${item.order.period.code} • ${item.order.period.name}`);
    grouped.set(key, current);
  }
  const ranking = [...grouped.values()]
    .map((item) => ({
      ...item,
      estimatedMargin: item.revenue - item.purchaseCost,
      estimatedMarginPercent: item.revenue ? ((item.revenue - item.purchaseCost) / item.revenue) * 100 : 0,
      events: [...item.events].slice(0, 5),
    }))
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, TOP_LIMIT);
  return serialize({
    period: window.label,
    calculationNote: 'Revenue produk memakai target_price_idr × quantity. Margin produk bersifat estimasi karena fee, diskon, ongkir, dan invoice gabungan berada pada level pesanan/invoice.',
    ranking,
  });
}

export async function eventPerformance() {
  const [periods, invoices, purchases, expenses, refunds] = await Promise.all([
    prisma.jastip_period.findMany({ where: { deleted_at: null }, select: { id: true, code: true, name: true, city: true, status: true } }),
    prisma.invoice.findMany({
      where: { deleted_at: null, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        total_bill: true,
        orders: { where: { order: { deleted_at: null } }, select: { order_id: true, snapshot_amount: true, order: { select: { period_id: true } } } },
      },
    }),
    prisma.purchase.findMany({ where: { order_item: { order: { deleted_at: null, invoice_links: { some: { invoice: { deleted_at: null, status: { not: 'CANCELLED' } } } } } } }, select: { actual_price: true, period_id: true } }),
    prisma.expense.findMany({ where: { deleted_at: null, period_id: { not: null } }, select: { period_id: true, amount_idr: true } }),
    prisma.refund.findMany({ where: { deleted_at: null, status: 'PAID' }, select: { amount: true, order_id: true, invoice_id: true } }),
  ]);

  const orderPeriod = new Map<number, number>();
  for (const invoice of invoices) for (const link of invoice.orders) orderPeriod.set(link.order_id, link.order.period_id);
  const invoice_links = new Map(invoices.map((invoice) => [invoice.id, invoice.orders]));
  const metrics = new Map<number, { orders: Set<number>; omzet: number; modal: number; expenses: number; refunds: number }>();
  const get = (period_id: number) => {
    const current = metrics.get(period_id) || { orders: new Set<number>(), omzet: 0, modal: 0, expenses: 0, refunds: 0 };
    metrics.set(period_id, current);
    return current;
  };
  for (const invoice of invoices) {
    for (const link of invoice.orders) {
      const metric = get(link.order.period_id);
      metric.orders.add(link.order_id);
      metric.omzet += Number(link.snapshot_amount);
    }
  }
  for (const purchase of purchases) get(purchase.period_id).modal += Number(purchase.actual_price);
  for (const expense of expenses) if (expense.period_id) get(expense.period_id).expenses += Number(expense.amount_idr);
  for (const refund of refunds) {
    if (refund.order_id && orderPeriod.has(refund.order_id)) {
      get(orderPeriod.get(refund.order_id)!).refunds += Number(refund.amount);
      continue;
    }
    if (refund.invoice_id) {
      const links = invoice_links.get(refund.invoice_id) || [];
      const total = links.reduce((sum, link) => sum + Number(link.snapshot_amount), 0);
      if (total > 0) {
        for (const link of links) get(link.order.period_id).refunds += Number(refund.amount) * (Number(link.snapshot_amount) / total);
      }
    }
  }
  const ranking = periods
    .map((period) => {
      const metric = get(period.id);
      const netProfit = metric.omzet - metric.modal - metric.expenses - metric.refunds;
      return {
        code: period.code,
        event: period.name,
        city: period.city || 'Indonesia',
        status: period.status,
        orders: metric.orders.size,
        omzet: metric.omzet,
        capital: metric.modal,
        expenses: metric.expenses,
        refunds: metric.refunds,
        netProfit,
        marginPercent: metric.omzet ? (netProfit / metric.omzet) * 100 : 0,
      };
    })
    .sort((a, b) => b.netProfit - a.netProfit)
    .slice(0, TOP_LIMIT);
  return serialize({ calculationNote: 'Omzet event memakai snapshot_amount pada invoice gabungan. Refund invoice dialokasikan proporsional ke event terkait.', ranking });
}

function itemLabel(item: any) {
  return item.product?.name || item.manual_product_name || 'Produk tanpa nama';
}

export async function operationsIntelligence() {
  const [items, shipments] = await Promise.all([
    prisma.order_item.findMany({
      where: { order: { deleted_at: null, status: { notIn: ['COMPLETED', 'CANCELLED', 'REFUND'] } } },
      select: {
        id: true,
        manual_product_name: true,
        brand_name: true,
        quantity: true,
        purchase_status: true,
        fulfillment_status: true,
        status_updated_at: true,
        kept_until: true,
        product: { select: { name: true, sku: true } },
        order: { select: { order_number: true, order_date: true, status: true, customer: { select: { full_name: true } }, period: { select: { code: true, name: true } } } },
      },
      orderBy: { status_updated_at: 'asc' },
    }),
    prisma.shipment.findMany({
      where: { status: { notIn: ['DELIVERED', 'RETURNED'] }, order: { deleted_at: null } },
      select: {
        tracking_number: true,
        status: true,
        courier: true,
        shipped_at: true,
        created_at: true,
        order: { select: { order_number: true } },
        customer: { select: { full_name: true } },
      },
      orderBy: { created_at: 'asc' },
    }),
  ]);
  const now = Date.now();
  const toRecord = (item: any) => ({
    order_number: item.order.order_number,
    customer: item.order.customer.full_name,
    event: `${item.order.period.code} • ${item.order.period.name}`,
    product: itemLabel(item),
    sku: item.product?.sku || null,
    brand: item.product?.name ? item.brand_name || null : item.brand_name,
    quantity: item.quantity,
    purchase_status: item.purchase_status,
    fulfillment_status: item.fulfillment_status,
    orderStatus: item.order.status,
    statusAgeDays: Math.max(0, Math.floor((now - item.status_updated_at.getTime()) / 86_400_000)),
    kept_until: item.kept_until,
  });
  const pendingPurchase = items.filter((item) => ['PENDING', 'FOUND', 'PRICE_CHANGED', 'REPLACED'].includes(item.purchase_status));
  const notReadyToShip = items.filter((item) => item.purchase_status === 'PURCHASED' && ['PENDING', 'SEARCHING'].includes(item.fulfillment_status));
  const waitingShipment = items.filter((item) => ['AVAILABLE', 'KEPT', 'READY_TO_SHIP'].includes(item.fulfillment_status));
  return serialize({
    pendingPurchaseCount: pendingPurchase.length,
    pendingPurchase: pendingPurchase.slice(0, TOP_LIMIT).map(toRecord),
    purchasedNotReadyCount: notReadyToShip.length,
    purchasedNotReady: notReadyToShip.slice(0, TOP_LIMIT).map(toRecord),
    waitingShipmentCount: waitingShipment.length,
    waitingShipment: waitingShipment.slice(0, TOP_LIMIT).map(toRecord),
    customerNotReceivedCount: shipments.length,
    customerNotReceived: shipments.slice(0, TOP_LIMIT).map((shipment) => ({
      order_number: shipment.order.order_number,
      customer: shipment.customer.full_name,
      tracking_number: shipment.tracking_number,
      courier: shipment.courier,
      shipmentStatus: shipment.status,
      shipped_at: shipment.shipped_at,
      ageDays: Math.max(0, Math.floor((now - shipment.created_at.getTime()) / 86_400_000)),
    })),
    dataLimitation: 'Schema saat ini belum memiliki status khusus perjalanan barang dari shopper ke gudang. Kategori “purchasedNotReady” berarti barang sudah berstatus PURCHASED tetapi fulfillment masih PENDING/SEARCHING; status AVAILABLE/KEPT/READY_TO_SHIP masuk kategori menunggu pengiriman.',
  });
}
