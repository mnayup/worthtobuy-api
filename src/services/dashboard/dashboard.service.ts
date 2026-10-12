import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { ReminderService } from '../shared/reminder.service';
import {
  buildDailyTrends,
  buildTopCustomers,
  buildTopProducts,
} from './helpers/dashboard-charts.helper';
import { fetchDashboardAlerts } from './helpers/dashboard-alerts.helper';
import {
  calculateInvoiceScopes,
  calculatePaymentsAndRefunds,
} from './helpers/dashboard-finance.helper';

type DateRange = { gte?: Date; lte?: Date };

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private reminderService: ReminderService,
  ) {}

  private dateFilter(query: Record<string, any>): DateRange | undefined {
    const start = query.start ? new Date(String(query.start)) : undefined;
    const end = query.end ? new Date(String(query.end)) : undefined;
    return start || end ? { gte: start, lte: end } : undefined;
  }

  async getDashboardData(query: Record<string, any>) {
    await this.reminderService.syncPaymentReminders();
    const date = this.dateFilter(query);
    const period_id = query.period_id
      ? Number(query.period_id)
      : query.periodId
        ? Number(query.periodId)
        : undefined;

    const orderWhere: any = {
      deleted_at: null,
      ...(date ? { order_date: date } : {}),
      ...(period_id ? { period_id } : {}),
    };
    const expenseWhere: any = {
      deleted_at: null,
      ...(date ? { expense_date: date } : {}),
      ...(period_id ? { period_id } : {}),
    };
    const invoiceWhere: any = {
      deleted_at: null,
      ...(date ? { invoice_date: date } : {}),
      ...(period_id
        ? { orders: { some: { order: { period_id, deleted_at: null } } } }
        : {}),
    };

    const [
      orders,
      expenses,
      allPurchases,
      allPayments,
      customers,
      statusGroups,
      invoices,
      products,
      allRefunds,
      alerts,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: orderWhere,
        include: {
          items: { include: { product: true } },
          customer: true,
        },
      }),
      this.prisma.expense.findMany({ where: expenseWhere }),
      this.prisma.purchase.findMany({
        where: {
          ...(period_id ? { period_id } : {}),
          order_item: { order: { deleted_at: null } },
        },
        include: { order_item: { select: { order_id: true } } },
      }),
      this.prisma.payment.findMany({
        where: {
          deleted_at: null,
          status: 'VERIFIED',
          ...(date ? { payment_date: date } : {}),
        },
      }),
      this.prisma.customer.count({ where: { deleted_at: null } }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: orderWhere,
        _count: { _all: true },
      }),
      this.prisma.invoice.findMany({
        where: invoiceWhere,
        include: {
          customer: true,
          orders: {
            where: {
              order: {
                deleted_at: null,
                ...(period_id ? { period_id } : {}),
              },
            },
            include: { order: { include: { items: true, customer: true } } },
          },
        },
        orderBy: { invoice_date: 'desc' },
      }),
      this.prisma.product.findMany({
        where: {
          stock_mode: { in: ['READY_STOCK', 'BOTH'] },
          is_active: true,
          deleted_at: null,
        },
      }),
      this.prisma.refund.findMany({
        where: {
          deleted_at: null,
          status: 'PAID',
          ...(date ? { refunded_at: date } : {}),
        },
      }),
      fetchDashboardAlerts(this.prisma, period_id),
    ]);

    const invoiceScopes = calculateInvoiceScopes(invoices, period_id);
    const { payments, refunds, financialOrders, financialOrderIds } =
      calculatePaymentsAndRefunds(allPayments, allRefunds, invoiceScopes);

    const purchases = allPurchases.filter((purchase) =>
      financialOrderIds.has(Number(purchase.order_item.order_id)),
    );

    const omzet = invoiceScopes.reduce((sum, s) => sum + s.scopedBill, 0);
    const goodsRevenue = financialOrders.reduce(
      (sum, order) => sum + Number(order.product_subtotal_idr || 0),
      0,
    );
    const serviceFees = financialOrders.reduce(
      (sum, order) => sum + Number(order.service_fee || 0),
      0,
    );
    const itemCount = orders.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    );
    const averageOrder = invoiceScopes.length
      ? Math.round(omzet / invoiceScopes.length)
      : 0;
    const modal = purchases.reduce(
      (sum, purchase) => sum + Number(purchase.actual_price || 0),
      0,
    );
    const actualBuyPrice = modal;
    const estimatedBuyPrice = purchases.reduce(
      (sum, p) => sum + Number(p.estimated_price || p.actual_price || 0),
      0,
    );
    const shoppingVariance = estimatedBuyPrice - actualBuyPrice;
    const operational = expenses.reduce(
      (sum, exp) => sum + Number(exp.amount_idr || 0),
      0,
    );
    const refundTotal = refunds.reduce((sum, r) => sum + r.scopedAmount, 0);
    const netProfit = omzet - modal - operational - refundTotal;
    const paymentsTotal = payments.reduce((sum, p) => sum + p.scopedAmount, 0);
    const outstanding = invoiceScopes.reduce(
      (sum, scope) => sum + scope.scopedOutstanding,
      0,
    );

    const paymentMethods: Record<string, number> = {};
    payments.forEach((p) => {
      paymentMethods[p.method] =
        (paymentMethods[p.method] || 0) + p.scopedAmount;
    });

    const lowStockAlerts = products
      .filter(
        (p) =>
          p.stock_quantity - p.reserved_quantity <= p.low_stock_threshold,
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        available: p.stock_quantity - p.reserved_quantity,
        threshold: p.low_stock_threshold,
      }));

    const stats = {
      totalOrders: orders.length,
      itemCount,
      omzet,
      averageOrder,
      serviceFees,
      outstanding,
      unpaidOrders: invoiceScopes.filter((s) => s.scopedOutstanding > 0).length,
      cashIn: paymentsTotal,
      cashOut: modal + operational,
      readyToShip: orders.filter((o) =>
        ['READY_TO_SHIP', 'WAITING_PACKING', 'PACKED'].includes(o.status),
      ).length,
      completed: orders.filter((o) => o.status === 'COMPLETED').length,
      invoiceCount: invoiceScopes.length,
    };

    const charts = {
      daily: buildDailyTrends(invoices),
      statusGroups,
      topProducts: buildTopProducts(orders),
      topCustomers: buildTopCustomers(orders),
    };

    return {
      stats,
      charts,
      alerts,
      kpi: {
        omzet,
        goodsRevenue,
        serviceFees,
        modal,
        actualBuyPrice,
        estimatedBuyPrice,
        shoppingVariance,
        shoppingEfficiency:
          estimatedBuyPrice > 0
            ? (shoppingVariance / estimatedBuyPrice) * 100
            : 0,
        netProfit,
        profitMargin: omzet ? (netProfit / omzet) * 100 : 0,
        orders: orders.length,
        itemCount,
        averageOrder,
        customers,
        outstanding,
        paymentsTotal,
        operational,
        refundTotal,
      },
      paymentMethods,
      orderStatuses: statusGroups.map((group) => ({
        status: group.status,
        count: group._count._all,
      })),
      lowStockAlerts,
      recentActivity: orders.slice(0, 10).map((o) => ({
        id: o.id,
        action: 'ORDER_PLACED',
        entity: o.order_number,
        createdAt: o.created_at,
        customerName: o.customer?.full_name,
      })),
    };
  }
}
