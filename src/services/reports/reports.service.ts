import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import {
  calculateReadyStockValuation,
  computeFinancialOrderTotals,
} from './helpers/profit-loss.helper';
import { aggregatePeriodPerformance } from './helpers/period-performance.helper';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getProfitLoss(period_id?: number, can_view_profit = true) {
    if (!can_view_profit) throw new ForbiddenException('Akses laporan laba rugi dinonaktifkan untuk akun ini.');

    const invoiceWhere: any = {
      deleted_at: null,
      ...(period_id ? { orders: { some: { order: { period_id, deleted_at: null } } } } : {}),
    };

    const [invoices, allPayments, readyStockProducts] = await Promise.all([
      this.prisma.invoice.findMany({
        where: invoiceWhere,
        include: {
          orders: {
            where: { order: { deleted_at: null, ...(period_id ? { period_id } : {}) } },
            include: {
              order: {
                select: {
                  id: true,
                  period_id: true,
                  product_subtotal_idr: true,
                  service_fee: true,
                  local_shipping: true,
                  international_shipping: true,
                  customer_shipping: true,
                  additional_fee: true,
                  discount: true,
                  total_bill: true,
                  items: {
                    select: {
                      id: true,
                      quantity: true,
                      target_price_idr: true,
                      unit_price_foreign: true,
                      purchases: {
                        select: {
                          id: true,
                          estimated_price: true,
                          actual_price: true,
                          price_difference: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: { deleted_at: null, status: 'VERIFIED' },
      }),
      this.prisma.product.findMany({
        where: {
          stock_mode: { in: ['READY_STOCK', 'BOTH'] },
          is_active: true,
          deleted_at: null,
        },
        orderBy: { stock_quantity: 'desc' },
      }),
    ]);

    const invoiceScopes = invoices
      .map((invoice) => {
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
      })
      .filter((scope) => scope.scopedBill > 0);

    const activeInvoiceIds = new Set<number>(invoiceScopes.map((scope) => Number(scope.invoice.id)));
    const invoiceRatioById = new Map<number, number>(
      invoiceScopes.map((scope) => [Number(scope.invoice.id), Number(scope.ratio)])
    );
    const financialOrders = invoiceScopes.flatMap((scope) =>
      scope.invoice.orders.map((link) => ({ order: link.order, ratio: scope.ratio }))
    );
    const orderIds = [...new Set(financialOrders.map((f) => Number(f.order.id)))];

    const [purchases, expenses, allRefunds] = await Promise.all([
      orderIds.length
        ? this.prisma.purchase.findMany({
            where: { order_item: { order_id: { in: orderIds }, order: { deleted_at: null } } },
            include: { order_item: { select: { target_price_idr: true, quantity: true } } },
          })
        : Promise.resolve([]),
      this.prisma.expense.findMany({
        where: { deleted_at: null, ...(period_id ? { period_id } : {}) },
      }),
      this.prisma.refund.findMany({
        where: { deleted_at: null, status: 'PAID' },
      }),
    ]);

    const { goodsRevenue, serviceFeeIncome, otherFeeIncome, discountTotal } =
      computeFinancialOrderTotals(financialOrders);

    const actualBuyPrice = purchases.reduce((sum, p) => sum + Number(p.actual_price || 0), 0);
    const estimatedBuyPriceFromPurchases = purchases.reduce(
      (sum, p) => sum + Number(p.estimated_price || p.order_item?.target_price_idr || 0),
      0
    );

    const purchasedOrderItemIds = new Set(purchases.map((p) => p.order_item_id));
    let unpurchasedEstimatedCost = 0;
    financialOrders.forEach(({ order, ratio }) => {
      (order.items || []).forEach((item) => {
        if (!purchasedOrderItemIds.has(item.id)) {
          unpurchasedEstimatedCost += Number(item.target_price_idr || 0) * item.quantity * ratio;
        }
      });
    });

    const totalEstimatedBuyPrice = estimatedBuyPriceFromPurchases + unpurchasedEstimatedCost;
    const shoppingVariance = totalEstimatedBuyPrice - actualBuyPrice;
    const shoppingEfficiency =
      totalEstimatedBuyPrice > 0 ? (shoppingVariance / totalEstimatedBuyPrice) * 100 : 0;

    const goodsMargin = goodsRevenue - actualBuyPrice;
    const goodsMarginPercent = goodsRevenue > 0 ? (goodsMargin / goodsRevenue) * 100 : 0;

    const nonShopeeRefunds = allRefunds.filter((r) => r.source !== 'SHOPEE_CHECKOUT');
    const shopeeRefunds = allRefunds.filter((r) => r.source === 'SHOPEE_CHECKOUT');

    const getRefundValue = (ref: typeof allRefunds[0]) => {
      if (ref.invoice_id && activeInvoiceIds.has(ref.invoice_id)) {
        return Number(ref.amount) * (invoiceRatioById.get(Number(ref.invoice_id)) || 0);
      }
      if (ref.order_id && orderIds.includes(Number(ref.order_id))) return Number(ref.amount);
      return 0;
    };

    const refund = nonShopeeRefunds.reduce((sum, r) => sum + getRefundValue(r), 0);
    const shopeeRefundTotal = shopeeRefunds.reduce((sum, r) => sum + getRefundValue(r), 0);

    const operational = expenses.reduce((sum, row) => sum + Number(row.amount_idr), 0);
    const expenseBreakdown = expenses.reduce(
      (acc, e) => {
        const cat = e.category || 'OTHER';
        acc[cat] = (acc[cat] || 0) + Number(e.amount_idr || 0);
        return acc;
      },
      {} as Record<string, number>
    );

    const omzet = invoiceScopes.reduce((sum, scope) => sum + scope.scopedBill, 0);
    const grossProfit = omzet - actualBuyPrice;
    const netProfit = grossProfit - operational - refund;
    const receivables = invoiceScopes.reduce((sum, scope) => sum + scope.scopedOutstanding, 0);

    const verifiedPayments = allPayments.map((p) => {
      if (p.invoice_id && activeInvoiceIds.has(p.invoice_id)) {
        return Number(p.amount) * (invoiceRatioById.get(Number(p.invoice_id)) || 0);
      }
      if (p.order_id && orderIds.includes(Number(p.order_id))) return Number(p.amount);
      return 0;
    });
    const verifiedCashIn = verifiedPayments.reduce((sum, val) => sum + val, 0);

    const readyStock = calculateReadyStockValuation(readyStockProducts);

    return {
      omzet,
      modal: actualBuyPrice,
      actualBuyPrice,
      estimatedBuyPrice: totalEstimatedBuyPrice,
      shoppingVariance,
      shoppingEfficiency,
      goodsRevenue,
      goodsMargin,
      goodsMarginPercent,
      serviceFeeIncome,
      otherFeeIncome,
      discountTotal,
      operational,
      expenseBreakdown,
      refund,
      shopeeRefund: shopeeRefundTotal,
      grossProfit,
      netProfit,
      margin: omzet ? (netProfit / omzet) * 100 : 0,
      receivables,
      verifiedCashIn,
      cashOutflow: actualBuyPrice + operational + refund,
      netCashFlow: verifiedCashIn - (actualBuyPrice + operational + refund),
      readyStock,
    };
  }

  async getPeriodPerformance() {
    const [periods, invoices, purchases, expenses] = await Promise.all([
      this.prisma.jastip_period.findMany({ where: { deleted_at: null } }),
      this.prisma.invoice.findMany({
        where: { deleted_at: null },
        include: {
          orders: {
            where: { order: { deleted_at: null } },
            include: {
              order: {
                select: {
                  id: true,
                  period_id: true,
                  product_subtotal_idr: true,
                  service_fee: true,
                  total_bill: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.purchase.findMany({
        where: {
          order_item: {
            order: { deleted_at: null, invoice_links: { some: { invoice: { deleted_at: null } } } },
          },
        },
        include: { order_item: { select: { order_id: true, order: { select: { period_id: true } } } } },
      }),
      this.prisma.expense.findMany({ where: { deleted_at: null } }),
    ]);

    return aggregatePeriodPerformance(periods, invoices, purchases, expenses);
  }
}
