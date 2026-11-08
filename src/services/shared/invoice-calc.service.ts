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
      include: {
        orders: {
          include: {
            order: {
              include: {
                shipments: true,
                shipment_orders: { include: { shipment: true } },
              },
            },
          },
        },
      },
    });
    const orderIds = invoice.orders.map((link) => link.order_id);
    const [payments, settledOverpaymentRefunds, unresolvedItemRefunds] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          status: 'VERIFIED',
          deleted_at: null,
          OR: [{ invoice_id }, ...(orderIds.length ? [{ order_id: { in: orderIds } }] : [])],
        },
        orderBy: [{ payment_date: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.refund.findMany({
        where: { invoice_id, source: 'OVERPAYMENT', status: { in: ['PAID', 'REJECTED'] } },
      }),
      this.prisma.refund.count({
        where: { invoice_id, source: 'UNAVAILABLE_ITEM', status: { in: ['REQUESTED', 'ON_PROCESS', 'APPROVED'] } },
      }),
    ]);

    const paid_amount = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const deposit_amount = Number(invoice.deposit_amount || 0);

    const total_bill = invoice.orders.length > 0
      ? invoice.orders.reduce((sum, link) => {
          const orderTotal = link.order
            ? Number(link.order.total_bill)
            : Number(link.snapshot_amount || 0);
          return sum + orderTotal;
        }, 0)
      : Number(invoice.total_bill);

    const effectivePaid = paid_amount + deposit_amount;
    const outstanding_amount = Math.max(0, total_bill - effectivePaid);
    const refundedOverpayment = settledOverpaymentRefunds.reduce(
      (sum, refund) => sum + Number(refund.amount),
      0
    );
    const overpayment_amount = Math.max(0, effectivePaid - total_bill - refundedOverpayment);

    let status: 'ISSUED' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'REFUND_DUE' = 'ISSUED';
    if (overpayment_amount > 0 || unresolvedItemRefunds > 0) status = 'REFUND_DUE';
    else if (outstanding_amount <= 0) status = 'PAID';
    else if (effectivePaid > 0) status = 'PARTIAL';

    let nextDpAmount: number | undefined;
    if (invoice.billing_model === 'DP') {
      if (invoice.dp_percent) {
        nextDpAmount = Math.round((total_bill * invoice.dp_percent) / 100);
      } else if (invoice.dp_amount) {
        nextDpAmount = Number(invoice.dp_amount);
      }
    }

    await this.prisma.invoice.update({
      where: { id: invoice_id },
      data: {
        total_bill,
        paid_amount,
        outstanding_amount,
        overpayment_amount,
        status,
        ...(nextDpAmount !== undefined ? { dp_amount: nextDpAmount } : {}),
      },
    });

    const directByOrder = new Map<number, number>();
    let invoicePool = deposit_amount;
    for (const payment of payments) {
      if (payment.order_id) directByOrder.set(payment.order_id, (directByOrder.get(payment.order_id) || 0) + Number(payment.amount));
      else invoicePool += Number(payment.amount);
    }

    // In a multi-order invoice, if a payment was registered with an order_id but its amount
    // exceeds that order's total_bill (e.g. customer paid the whole invoice against a single order),
    // cap the order's direct allocation at its total_bill and release the excess into invoicePool
    // so sibling orders in the same invoice can be fulfilled and settled.
    for (const link of invoice.orders) {
      const total = Number(link.order?.total_bill ?? link.snapshot_amount ?? 0);
      const direct = directByOrder.get(link.order_id) || 0;
      if (direct > total) {
        const excess = direct - total;
        directByOrder.set(link.order_id, total);
        invoicePool += excess;
      }
    }

    const sortedLinks = [...invoice.orders].sort(
      (a, b) => a.order.order_date.getTime() - b.order.order_date.getTime()
    );

    const getOrderPositiveShippingVariance = (ord: any): number => {
      const shipmentMap = new Map<number, any>();
      for (const s of ord?.shipments || []) {
        if (s?.id) shipmentMap.set(s.id, s);
      }
      for (const so of ord?.shipment_orders || []) {
        if (so?.shipment?.id) shipmentMap.set(so.shipment.id, so.shipment);
      }
      let variance = 0;
      for (const s of shipmentMap.values()) {
        if (s.order_id === ord.id && Number(s.shipping_cost_difference || 0) > 0) {
          variance += Number(s.shipping_cost_difference);
        }
      }
      return variance;
    };

    // Pass 1: Allocate invoicePool to each order's base bill (excluding positive shipping variance)
    // so that an ongkir shortage on one order never steals base payment from sibling orders.
    const baseAllocByOrder = new Map<number, number>();
    for (const link of sortedLinks) {
      const total = Number(link.order.total_bill);
      const variance = getOrderPositiveShippingVariance(link.order);
      const baseTotal = Math.max(0, total - variance);
      const direct = directByOrder.get(link.order_id) || 0;
      const baseNeed = Math.max(0, baseTotal - direct);
      const baseAlloc = Math.min(baseNeed, invoicePool);
      invoicePool -= baseAlloc;
      baseAllocByOrder.set(link.order_id, baseAlloc);
    }

    // Pass 2: Allocate any remaining invoicePool to shipping variance / remaining bill
    const totalAllocByOrder = new Map<number, number>();
    for (const link of sortedLinks) {
      const total = Number(link.order.total_bill);
      const direct = directByOrder.get(link.order_id) || 0;
      const baseAlloc = baseAllocByOrder.get(link.order_id) || 0;
      const remainingNeed = Math.max(0, total - (direct + baseAlloc));
      const varAlloc = Math.min(remainingNeed, invoicePool);
      invoicePool -= varAlloc;
      totalAllocByOrder.set(link.order_id, baseAlloc + varAlloc);
    }

    for (const link of sortedLinks) {
      const total = Number(link.order.total_bill);
      const direct = directByOrder.get(link.order_id) || 0;
      const allocation = totalAllocByOrder.get(link.order_id) || 0;
      const orderPaid = direct + allocation;
      const orderOutstanding = Math.max(0, total - orderPaid);

      const orderData = await this.prisma.order.findUnique({
        where: { id: link.order_id },
        include: { customer: true, period: true, items: { include: { product: true } } },
      });
      const isPriorityCustomer = orderData?.customer?.segment === 'PRIORITY';
      const isReadyStockOrder =
        orderData?.period?.type === 'LIVE_SHOPPING' ||
        orderData?.period?.code === 'READY-STOCK' ||
        ((orderData?.items || []).length > 0 &&
          orderData.items.every((it) => it.source_type === 'READY_STOCK' || it.product?.stock_mode === 'READY_STOCK'));

      let nextStatus = link.order.status;
      let shouldEnsureShipment = false;
      if (isReadyStockOrder) {
        if (orderPaid > 0 || isPriorityCustomer) {
          nextStatus = orderOutstanding <= 0 ? 'READY_TO_SHIP' : 'WAITING_SETTLEMENT';
          shouldEnsureShipment = true;
          for (const it of orderData?.items || []) {
            await this.prisma.order_item.update({
              where: { id: it.id },
              data: { fulfillment_status: 'AVAILABLE', purchase_status: 'PURCHASED', status_updated_at: new Date() },
            });
          }
        }
      } else {
        const activeItems = (orderData?.items || []).filter(
          (it) => it.fulfillment_status !== 'UNAVAILABLE'
        );
        const allItemsBought =
          activeItems.length > 0 &&
          activeItems.every((it) =>
            ['AVAILABLE', 'KEPT', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'].includes(it.fulfillment_status)
          );
        const allKept =
          activeItems.length > 0 &&
          activeItems.every((it) => it.fulfillment_status === 'KEPT');

        if (['NEW', 'WAITING_DP', 'DP_RECEIVED', 'WAITING_PURCHASE', 'PURCHASED'].includes(link.order.status)) {
          if (allItemsBought && !allKept) {
            nextStatus = orderOutstanding <= 0 ? 'READY_TO_SHIP' : 'WAITING_SETTLEMENT';
            if (orderOutstanding <= 0) {
              shouldEnsureShipment = true;
            }
          } else if (orderPaid > 0 || isPriorityCustomer) {
            if (['NEW', 'WAITING_DP', 'DP_RECEIVED'].includes(link.order.status)) {
              nextStatus = 'WAITING_PURCHASE';
            }
          } else if (invoice.billing_model === 'DP' && link.order.status === 'NEW') {
            nextStatus = 'WAITING_DP';
          }
        } else if (link.order.status === 'WAITING_SETTLEMENT' || link.order.status === 'READY_TO_SHIP') {
          if (orderOutstanding <= 0) {
            const ship = await this.prisma.shipment.findFirst({
              where: {
                OR: [
                  { order_id: link.order_id },
                  { shipment_orders: { some: { order_id: link.order_id } } },
                ],
              },
            });
            if (ship && ship.tracking_number) {
              nextStatus = 'SHIPPED';
              await this.prisma.shipment.update({
                where: { id: ship.id },
                data: { status: 'IN_TRANSIT', shipped_at: ship.shipped_at || new Date() },
              });
            } else {
              nextStatus = 'READY_TO_SHIP';
              if (ship && ship.status === 'WAITING_SETTLEMENT') {
                await this.prisma.shipment.update({
                  where: { id: ship.id },
                  data: { status: ship.packed_at ? 'PACKED' : 'WAITING_PACKING' },
                });
              }
              shouldEnsureShipment = true;
            }
          } else {
            nextStatus = 'WAITING_SETTLEMENT';
          }
        }
      }

      await this.prisma.order.update({
        where: { id: link.order_id },
        data: { paid_amount: orderPaid, outstanding_amount: orderOutstanding, status: nextStatus as any },
      });

      if (shouldEnsureShipment) {
        await this.ensureShipmentForOrder(link.order_id);
      }

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
    const [order, payments, invoiceLinks] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id: order_id } }),
      this.prisma.payment.findMany({ where: { order_id, status: 'VERIFIED', deleted_at: null } }),
      this.prisma.invoice_order.findMany({
        where: { order_id },
        include: { invoice: true },
      }),
    ]);
    const paid_amount = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const outstanding_amount = Math.max(0, Number(order.total_bill) - paid_amount);

    const orderData = await this.prisma.order.findUnique({
      where: { id: order_id },
      include: { customer: true, period: true, items: { include: { product: true } } },
    });
    const isPriorityCustomer = orderData?.customer?.segment === 'PRIORITY';
    const isReadyStockOrder =
      orderData?.period?.type === 'LIVE_SHOPPING' ||
      orderData?.period?.code === 'READY-STOCK' ||
      ((orderData?.items || []).length > 0 &&
        orderData.items.every((it) => it.source_type === 'READY_STOCK' || it.product?.stock_mode === 'READY_STOCK'));

    let nextStatus = order.status;
    let shouldEnsureShipment = false;
    if (isReadyStockOrder) {
      if (paid_amount > 0 || isPriorityCustomer) {
        nextStatus = outstanding_amount <= 0 ? 'READY_TO_SHIP' : 'WAITING_SETTLEMENT';
        shouldEnsureShipment = true;
        for (const it of orderData?.items || []) {
          await this.prisma.order_item.update({
            where: { id: it.id },
            data: { fulfillment_status: 'AVAILABLE', purchase_status: 'PURCHASED', status_updated_at: new Date() },
          });
        }
      }
    } else {
      const activeItems = (orderData?.items || []).filter(
        (it) => it.fulfillment_status !== 'UNAVAILABLE'
      );
      const allItemsBought =
        activeItems.length > 0 &&
        activeItems.every((it) =>
          ['AVAILABLE', 'KEPT', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'].includes(it.fulfillment_status)
        );
      const allKept =
        activeItems.length > 0 &&
        activeItems.every((it) => it.fulfillment_status === 'KEPT');

      if (['NEW', 'WAITING_DP', 'DP_RECEIVED', 'WAITING_PURCHASE', 'PURCHASED'].includes(order.status)) {
        if (allItemsBought && !allKept) {
          nextStatus = outstanding_amount <= 0 ? 'READY_TO_SHIP' : 'WAITING_SETTLEMENT';
          if (outstanding_amount <= 0) {
            shouldEnsureShipment = true;
          }
        } else if (paid_amount > 0 || isPriorityCustomer) {
          if (['NEW', 'WAITING_DP', 'DP_RECEIVED'].includes(order.status)) {
            nextStatus = 'WAITING_PURCHASE';
          }
        } else if (invoiceLinks.some((l) => l.invoice?.billing_model === 'DP') && order.status === 'NEW') {
          nextStatus = 'WAITING_DP';
        }
      } else if (order.status === 'WAITING_SETTLEMENT' || order.status === 'READY_TO_SHIP') {
        if (outstanding_amount <= 0) {
          const ship = await this.prisma.shipment.findFirst({
            where: {
              OR: [
                { order_id },
                { shipment_orders: { some: { order_id } } },
              ],
            },
          });
          if (ship && ship.tracking_number) {
            nextStatus = 'SHIPPED';
            await this.prisma.shipment.update({
              where: { id: ship.id },
              data: { status: 'IN_TRANSIT', shipped_at: ship.shipped_at || new Date() },
            });
          } else {
            nextStatus = 'READY_TO_SHIP';
            if (ship && ship.status === 'WAITING_SETTLEMENT') {
              await this.prisma.shipment.update({
                where: { id: ship.id },
                data: { status: ship.packed_at ? 'PACKED' : 'WAITING_PACKING' },
              });
            }
            shouldEnsureShipment = true;
          }
        } else {
          nextStatus = 'WAITING_SETTLEMENT';
        }
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: order_id },
      data: { paid_amount, outstanding_amount, status: nextStatus as any },
    });

    if (shouldEnsureShipment) {
      await this.ensureShipmentForOrder(order_id);
    }

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
