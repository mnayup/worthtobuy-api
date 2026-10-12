import { PrismaService } from '../../../config/prisma/prisma.service';

export async function fetchDashboardAlerts(
  prisma: PrismaService,
  period_id?: number,
) {
  const now = new Date();
  const periodOrderFilter = period_id ? { period_id } : {};

  const [overdueInvoices, unpurchasedItems, lateShipments] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        deleted_at: null,
        outstanding_amount: { gt: 0 },
        due_date: { lt: now },
        status: { notIn: ['PAID', 'CANCELLED'] },
        ...(period_id
          ? { orders: { some: { order: { period_id, deleted_at: null } } } }
          : {}),
      },
      select: {
        id: true,
        invoice_number: true,
        outstanding_amount: true,
        due_date: true,
      },
      take: 20,
    }),
    prisma.order_item.findMany({
      where: {
        purchase_status: { in: ['WAITING_PURCHASE', 'PENDING'] },
        order: {
          deleted_at: null,
          status: { notIn: ['CANCELLED', 'REFUND'] },
          ...periodOrderFilter,
        },
      },
      select: {
        id: true,
        order_id: true,
        manual_product_name: true,
        quantity: true,
      },
      take: 20,
    }),
    prisma.shipment.findMany({
      where: {
        status: { in: ['WAITING_PACKING', 'PACKED', 'WAITING_SETTLEMENT'] },
        order: {
          deleted_at: null,
          status: { notIn: ['CANCELLED', 'REFUND', 'SHIPPED', 'COMPLETED'] },
          ...periodOrderFilter,
        },
      },
      select: {
        id: true,
        order_id: true,
        status: true,
        created_at: true,
      },
      take: 20,
    }),
  ]);

  return {
    overduePayments: overdueInvoices,
    unpurchased: unpurchasedItems,
    lateShipments: lateShipments,
  };
}
