import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { ReminderService } from '../shared/reminder.service';

type DateRange = { gte?: Date; lte?: Date };

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private reminderService: ReminderService,
  ) { }

  private dateFilter(query: Record<string, any>): DateRange | undefined {
    const start = query.start ? new Date(String(query.start)) : undefined;
    const end = query.end ? new Date(String(query.end)) : undefined;
    return start || end ? { gte: start, lte: end } : undefined;
  }

  async getDashboardData(query: Record<string, any>) {
    await this.reminderService.syncPaymentReminders();
    const date = this.dateFilter(query);
    const period_id = query.period_id ? Number(query.period_id) : undefined;
    const orderWhere: any = { deleted_at: null, ...(date ? { order_date: date } : {}), ...(period_id ? { period_id } : {}) };
    const expenseWhere: any = { deleted_at: null, ...(date ? { expense_date: date } : {}), ...(period_id ? { period_id } : {}) };
    const invoiceWhere: any = {
      deleted_at: null,
      ...(date ? { invoice_date: date } : {}),
      ...(period_id ? { orders: { some: { order: { period_id, deleted_at: null } } } } : {}),
    };

    const [orders, expenses, allPurchases, allPayments, customers, statusGroups, invoices, products, allRefunds] =
      await Promise.all([
        this.prisma.order.findMany({ where: orderWhere, include: { items: true, customer: true } }),
        this.prisma.expense.findMany({ where: expenseWhere }),
        this.prisma.purchase.findMany({
          where: { ...(period_id ? { period_id } : {}), order_item: { order: { deleted_at: null } } },
          include: { order_item: { select: { order_id: true } } },
        }),
        this.prisma.payment.findMany({
          where: { deleted_at: null, status: 'VERIFIED', ...(date ? { payment_date: date } : {}) },
        }),
        this.prisma.customer.count({ where: { deleted_at: null } }),
        this.prisma.order.groupBy({ by: ['status'], where: orderWhere, _count: { _all: true } }),
        this.prisma.invoice.findMany({
          where: invoiceWhere,
          include: {
            customer: true,
            orders: {
              where: { order: { deleted_at: null, ...(period_id ? { period_id } : {}) } },
              include: { order: { include: { items: true, customer: true } } },
            },
          },
          orderBy: { invoice_date: 'desc' },
        }),
        this.prisma.product.findMany({ where: { stock_mode: { in: ['READY_STOCK', 'BOTH'] }, is_active: true, deleted_at: null } }),
        this.prisma.refund.findMany({ where: { deleted_at: null, status: 'PAID', ...(date ? { refunded_at: date } : {}) } }),
      ]);

    const invoiceScopes = invoices.map(invoice => {
      const total_bill = Number(invoice.total_bill);
      const scopedBill = period_id
        ? invoice.orders.reduce((sum, link) => sum + Number(link.snapshot_amount), 0)
        : total_bill;
      const ratio = total_bill > 0 ? Math.min(1, scopedBill / total_bill) : 0;
      return {
        invoice,
        scopedBill,
        ratio,
        scopedOutstanding: Number(invoice.outstanding_amount) * ratio,
      };
    }).filter(scope => scope.scopedBill > 0);

    const activeInvoiceIds = new Set<number>(invoiceScopes.map(scope => Number(scope.invoice.id)));
    const invoiceRatioById = new Map<number, number>(invoiceScopes.map(scope => [Number(scope.invoice.id), Number(scope.ratio)]));
    const financialOrders = invoiceScopes.flatMap(scope => scope.invoice.orders.map(link => link.order));
    const financialOrderIds = new Set<number>(financialOrders.map(order => Number(order.id)));

    const purchases = allPurchases.filter(purchase => financialOrderIds.has(Number(purchase.order_item.order_id)));
    const payments: Array<{ method: string; scopedAmount: number }> = [];
    allPayments.forEach(payment => {
      if (payment.invoice_id && activeInvoiceIds.has(Number(payment.invoice_id))) {
        payments.push({ method: payment.method, scopedAmount: Number(payment.amount) * (invoiceRatioById.get(Number(payment.invoice_id)) || 0) });
      } else if (payment.order_id && financialOrderIds.has(Number(payment.order_id))) {
        payments.push({ method: payment.method, scopedAmount: Number(payment.amount) });
      }
    });

    const refunds: Array<{ scopedAmount: number }> = [];
    allRefunds.forEach(refund => {
      if (refund.invoice_id && activeInvoiceIds.has(Number(refund.invoice_id))) {
        refunds.push({ scopedAmount: Number(refund.amount) * (invoiceRatioById.get(Number(refund.invoice_id)) || 0) });
      } else if (refund.order_id && financialOrderIds.has(Number(refund.order_id))) {
        refunds.push({ scopedAmount: Number(refund.amount) });
      }
    });

    const omzet = invoiceScopes.reduce((sum, scope) => sum + scope.scopedBill, 0);
    const goodsRevenue = financialOrders.reduce((sum, order) => sum + Number(order.product_subtotal_idr || 0), 0);
    const serviceFees = financialOrders.reduce((sum, order) => sum + Number(order.service_fee || 0), 0);
    const itemCount = orders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
    const averageOrder = invoiceScopes.length ? omzet / invoiceScopes.length : 0;
    const modal = purchases.reduce((sum, purchase) => sum + Number(purchase.actual_price || 0), 0);
    const actualBuyPrice = modal;
    const estimatedBuyPrice = purchases.reduce(
      (sum, purchase) => sum + Number(purchase.estimated_price || purchase.actual_price || 0),
      0,
    );
    const shoppingVariance = estimatedBuyPrice - actualBuyPrice;
    const operational = expenses.reduce((sum, expense) => sum + Number(expense.amount_idr || 0), 0);
    const refundTotal = refunds.reduce((sum, refund) => sum + refund.scopedAmount, 0);
    const netProfit = omzet - modal - operational - refundTotal;
    const paymentsTotal = payments.reduce((sum, payment) => sum + payment.scopedAmount, 0);
    const outstanding = invoiceScopes.reduce((sum, scope) => sum + scope.scopedOutstanding, 0);

    // Ready stock valuation
    const readyStockTotalCapital = products.reduce((sum, p) => sum + (Number(p.stock_quantity) * Number(p.buy_price || 0)), 0);
    const readyStockAvailableCapital = products.reduce(
      (sum, p) => sum + (Math.max(0, Number(p.stock_quantity) - Number(p.reserved_quantity)) * Number(p.buy_price || 0)),
      0,
    );
    const readyStockPotentialSales = products.reduce((sum, p) => sum + (Number(p.stock_quantity) * Number(p.selling_price || 0)), 0);
    const readyStockPotentialProfit = readyStockPotentialSales - readyStockTotalCapital;
    const readyStockUnits = products.reduce((sum, p) => sum + Number(p.stock_quantity), 0);
    const readyStockAvailableUnits = products.reduce(
      (sum, p) => sum + Math.max(0, Number(p.stock_quantity) - Number(p.reserved_quantity)),
      0,
    );

    const paymentMethods: Record<string, number> = {};
    payments.forEach(p => {
      paymentMethods[p.method] = (paymentMethods[p.method] || 0) + p.scopedAmount;
    });

    const lowStockAlerts = products
      .filter(p => p.stock_quantity - p.reserved_quantity <= p.low_stock_threshold)
      .map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        available: p.stock_quantity - p.reserved_quantity,
        threshold: p.low_stock_threshold,
      }));

    return {
      kpi: {
        omzet,
        goodsRevenue,
        serviceFees,
        modal,
        actualBuyPrice,
        estimatedBuyPrice,
        shoppingVariance,
        shoppingEfficiency: estimatedBuyPrice > 0 ? (shoppingVariance / estimatedBuyPrice) * 100 : 0,
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
        readyStock: {
          totalCapitalValue: readyStockTotalCapital,
          availableCapitalValue: readyStockAvailableCapital,
          totalPotentialSales: readyStockPotentialSales,
          potentialGrossProfit: readyStockPotentialProfit,
          potentialMargin: readyStockPotentialSales > 0 ? (readyStockPotentialProfit / readyStockPotentialSales) * 100 : 0,
          totalUnits: readyStockUnits,
          availableUnits: readyStockAvailableUnits,
          skuCount: products.length,
        },
      },
      paymentMethods,
      orderStatuses: statusGroups.map(group => ({ status: group.status, count: group._count._all })),
      lowStockAlerts,
      recentActivity: [],
    };
  }
}
