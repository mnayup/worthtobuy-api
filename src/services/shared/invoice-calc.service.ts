import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { RefundService } from './refund.service';
import {
  ensurePurchasesForOrderHelper,
  ensureShipmentForOrderHelper,
} from './helpers/order-fulfillment.helper';

@Injectable()
export class InvoiceCalcService {
  constructor(
    private prisma: PrismaService,
    private refundService: RefundService,
  ) { }

  async ensurePurchasesForOrder(order_id: number) {
    return ensurePurchasesForOrderHelper(this.prisma, order_id);
  }

  async ensureShipmentForOrder(order_id: number) {
    return ensureShipmentForOrderHelper(this.prisma, order_id);
  }

  private async syncCustomerDepositBalance(customer_id: number) {
    const depositRefunds = await this.prisma.refund.findMany({
      where: {
        deleted_at: null,
        status: 'PAID',
        refund_type: 'CUSTOMER_DEPOSIT',
        OR: [
          { customer_id },
          { order: { customer_id, deleted_at: null } },
          { invoice: { customer_id, deleted_at: null } },
        ],
      },
      select: { amount: true },
    });
    const totalDeposits = depositRefunds.reduce((sum, r) => sum + Number(r.amount), 0);
    const usedInvoices = await this.prisma.invoice.findMany({
      where: {
        customer_id,
        deleted_at: null,
        status: { not: 'CANCELLED' },
        deposit_amount: { gt: 0 },
      },
      select: { deposit_amount: true },
    });
    const totalUsed = usedInvoices.reduce((sum, inv) => sum + Number(inv.deposit_amount), 0);
    const availableDeposit = Math.max(0, totalDeposits - totalUsed);
    await this.prisma.customer.update({
      where: { id: customer_id },
      data: { deposit_balance: availableDeposit },
    });
  }

  async refreshInvoicePayment(invoice_id: number) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice_id },
      include: { orders: { include: { order: true } } },
    });
    const orderIds = invoice.orders.map((link) => link.order_id);
    const [payments, paidOverpaymentRefunds, unresolvedItemRefunds] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          status: 'VERIFIED',
          deleted_at: null,
          OR: [{ invoice_id }, ...(orderIds.length ? [{ order_id: { in: orderIds } }] : [])],
        },
        orderBy: [{ payment_date: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.refund.findMany({ where: { invoice_id, source: 'OVERPAYMENT', status: 'PAID' } }),
      this.prisma.refund.count({
        where: { invoice_id, source: 'UNAVAILABLE_ITEM', status: { in: ['REQUESTED', 'APPROVED'] } },
      }),
    ]);

    const paid_amount = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const deposit_amount = Number(invoice.deposit_amount || 0);
    const total_bill = Number(invoice.total_bill);
    const effectivePaid = paid_amount + deposit_amount;
    const outstanding_amount = Math.max(0, total_bill - effectivePaid);
    const refundedOverpayment = paidOverpaymentRefunds.reduce((sum, refund) => sum + Number(refund.amount), 0);
    const overpayment_amount = Math.max(0, effectivePaid - total_bill - refundedOverpayment);

    let status: 'ISSUED' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'REFUND_DUE' = 'ISSUED';
    if (overpayment_amount > 0 || unresolvedItemRefunds > 0) status = 'REFUND_DUE';
    else if (outstanding_amount <= 0) status = 'PAID';
    else if (effectivePaid > 0) status = 'PARTIAL';

    await this.prisma.invoice.update({
      where: { id: invoice_id },
      data: { paid_amount, outstanding_amount, overpayment_amount, status },
    });

    const directByOrder = new Map<number, number>();
    let invoicePool = deposit_amount;
    for (const payment of payments) {
      if (payment.order_id) directByOrder.set(payment.order_id, (directByOrder.get(payment.order_id) || 0) + Number(payment.amount));
      else invoicePool += Number(payment.amount);
    }

    for (const link of invoice.orders.sort((a, b) => a.order.order_date.getTime() - b.order.order_date.getTime())) {
      const total = Number(link.order.total_bill);
      const direct = directByOrder.get(link.order_id) || 0;
      const allocation = Math.min(Math.max(0, total - direct), invoicePool);
      invoicePool -= allocation;
      const orderPaid = direct + allocation;
      const orderOutstanding = Math.max(0, total - orderPaid);

      const orderData = await this.prisma.order.findUnique({
        where: { id: link.order_id },
        include: { customer: true, items: { include: { product: true } } },
      });
      const isPriorityCustomer = orderData?.customer?.segment === 'PRIORITY';
      const isReadyStockOrder =
        (orderData?.items || []).length > 0 &&
        orderData.items.every((it) => it.source_type === 'READY_STOCK' || it.product?.stock_mode === 'READY_STOCK');

      let nextStatus = link.order.status;
      if (isReadyStockOrder) {
        if (orderPaid > 0) {
          nextStatus = orderOutstanding <= 0 ? 'READY_TO_SHIP' : 'WAITING_SETTLEMENT';
          await this.ensureShipmentForOrder(link.order_id);
          for (const it of orderData.items) {
            await this.prisma.order_item.update({
              where: { id: it.id },
              data: { fulfillment_status: 'AVAILABLE', purchase_status: 'PURCHASED', status_updated_at: new Date() },
            });
          }
        }
      } else {
        if (['NEW', 'WAITING_DP', 'DP_RECEIVED'].includes(link.order.status)) {
          if (orderPaid > 0 || isPriorityCustomer) nextStatus = 'WAITING_PURCHASE';
        } else if (link.order.status === 'WAITING_SETTLEMENT') {
          if (orderOutstanding <= 0) {
            nextStatus = 'READY_TO_SHIP';
            await this.ensureShipmentForOrder(link.order_id);
          }
        }
      }

      await this.prisma.order.update({
        where: { id: link.order_id },
        data: { paid_amount: orderPaid, outstanding_amount: orderOutstanding, status: nextStatus as any },
      });

      if ((orderPaid > 0 || isPriorityCustomer) && !isReadyStockOrder) {
        await this.ensurePurchasesForOrder(link.order_id);
      }
    }

    await this.refundService.ensureOverpaymentRefund(invoice_id, overpayment_amount);
    if (orderIds.length) {
      const unavailableItems = await this.prisma.order_item.findMany({
        where: { order_id: { in: orderIds }, fulfillment_status: 'UNAVAILABLE' },
        select: { id: true },
      });
      for (const item of unavailableItems) {
        await this.refundService.ensureUnavailableItemRefund(item.id);
      }
    }

    if (invoice.customer_id) {
      await this.syncCustomerDepositBalance(invoice.customer_id);
    }

    return this.prisma.invoice.findUniqueOrThrow({ where: { id: invoice_id } });
  }

  async refreshOrderPayment(order_id: number) {
    const [order, payments] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id: order_id } }),
      this.prisma.payment.findMany({ where: { order_id, status: 'VERIFIED', deleted_at: null } }),
    ]);
    const paid_amount = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const outstanding_amount = Math.max(0, Number(order.total_bill) - paid_amount);

    const orderData = await this.prisma.order.findUnique({
      where: { id: order_id },
      include: { customer: true, items: { include: { product: true } } },
    });
    const isPriorityCustomer = orderData?.customer?.segment === 'PRIORITY';
    const isReadyStockOrder =
      (orderData?.items || []).length > 0 &&
      orderData.items.every((it) => it.source_type === 'READY_STOCK' || it.product?.stock_mode === 'READY_STOCK');

    let nextStatus = order.status;
    if (isReadyStockOrder) {
      if (paid_amount > 0) {
        nextStatus = outstanding_amount <= 0 ? 'READY_TO_SHIP' : 'WAITING_SETTLEMENT';
        await this.ensureShipmentForOrder(order_id);
        for (const it of orderData.items) {
          await this.prisma.order_item.update({
            where: { id: it.id },
            data: { fulfillment_status: 'AVAILABLE', purchase_status: 'PURCHASED', status_updated_at: new Date() },
          });
        }
      }
    } else {
      if (['NEW', 'WAITING_DP', 'DP_RECEIVED'].includes(order.status)) {
        if (paid_amount > 0 || isPriorityCustomer) nextStatus = 'WAITING_PURCHASE';
      } else if (order.status === 'WAITING_SETTLEMENT') {
        if (outstanding_amount <= 0) {
          nextStatus = 'READY_TO_SHIP';
          await this.ensureShipmentForOrder(order_id);
        }
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: order_id },
      data: { paid_amount, outstanding_amount, status: nextStatus as any },
    });

    if ((paid_amount > 0 || isPriorityCustomer) && !isReadyStockOrder) {
      await this.ensurePurchasesForOrder(order_id);
    }

    const unavailableItems = await this.prisma.order_item.findMany({
      where: { order_id, fulfillment_status: 'UNAVAILABLE' },
      select: { id: true },
    });
    for (const item of unavailableItems) {
      await this.refundService.ensureUnavailableItemRefund(item.id);
    }
    return updated;
  }

  async refreshPaymentTarget(input: { invoice_id?: number | null; order_id?: number | null }) {
    if (input.invoice_id) return this.refreshInvoicePayment(input.invoice_id);
    if (input.order_id) {
      const link = await this.prisma.invoice_order.findUnique({ where: { order_id: input.order_id } });
      if (link) return this.refreshInvoicePayment(link.invoice_id);
      return this.refreshOrderPayment(input.order_id);
    }
    return null;
  }
}
