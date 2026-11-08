import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { InvoiceCalcService } from './invoice-calc.service';

/**
 * Self-healing reconciler for order statuses that drifted from their payment state.
 *
 * Order statuses are only recalculated when a payment/invoice/purchase event happens.
 * Data created by older versions of the status logic (e.g. an invoice that is already fully
 * paid while its orders are still stuck in WAITING_SETTLEMENT) never receives a new event,
 * so it stays stale forever. This reconciler finds those inconsistent rows and re-runs the
 * standard, idempotent `refreshInvoicePayment` / `refreshOrderPayment` business logic on them.
 *
 * It runs automatically shortly after the API boots (i.e. right after every deploy) and then
 * periodically, so no manual SQL patch or human action is required.
 */
@Injectable()
export class OrderStatusReconcilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderStatusReconcilerService.name);
  private static readonly BOOT_DELAY_MS = 15_000;
  private static readonly INTERVAL_MS = 30 * 60 * 1000;
  private static readonly BATCH_LIMIT = 200;

  private bootTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceCalcService: InvoiceCalcService,
  ) { }

  onApplicationBootstrap() {
    if (process.env.DISABLE_ORDER_STATUS_RECONCILER === 'true') return;
    // Defer so the reconciliation never delays API startup.
    this.bootTimer = setTimeout(() => void this.reconcile(), OrderStatusReconcilerService.BOOT_DELAY_MS);
    this.intervalTimer = setInterval(() => void this.reconcile(), OrderStatusReconcilerService.INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
  }

  async reconcile() {
    if (this.running) return { invoices: 0, orders: 0 };
    this.running = true;
    let fixedInvoices = 0;
    let fixedOrders = 0;
    try {
      const { invoiceIds, standaloneOrderIds } = await this.findStaleTargets();

      for (const invoiceId of invoiceIds) {
        try {
          await this.invoiceCalcService.refreshInvoicePayment(invoiceId);
          fixedInvoices++;
        } catch (err: any) {
          this.logger.warn(`Failed to reconcile invoice #${invoiceId}: ${err?.message || err}`);
        }
      }

      for (const orderId of standaloneOrderIds) {
        try {
          await this.invoiceCalcService.refreshOrderPayment(orderId);
          fixedOrders++;
        } catch (err: any) {
          this.logger.warn(`Failed to reconcile order #${orderId}: ${err?.message || err}`);
        }
      }

      if (fixedInvoices || fixedOrders) {
        this.logger.log(
          `Reconciled stale order statuses: ${fixedInvoices} invoice(s), ${fixedOrders} standalone order(s).`
        );
      }
    } catch (err: any) {
      this.logger.error(`Order status reconciliation failed: ${err?.message || err}`);
    } finally {
      this.running = false;
    }
    return { invoices: fixedInvoices, orders: fixedOrders };
  }

  /**
   * Detects orders whose status is behind their payment state:
   *  1. The linked invoice is already fully settled, but the order is still waiting for payment/settlement.
   *  2. The order itself has no outstanding balance, but is still flagged as WAITING_SETTLEMENT.
   */
  private async findStaleTargets() {
    const limit = OrderStatusReconcilerService.BATCH_LIMIT;

    const settledInvoiceOrders = await this.prisma.order.findMany({
      where: {
        deleted_at: null,
        status: { in: ['DP_RECEIVED', 'WAITING_PURCHASE', 'PURCHASED', 'WAITING_SETTLEMENT'] },
        // Only orders whose items are all already bought; orders still waiting for purchase are legit.
        items: {
          some: { fulfillment_status: { not: 'UNAVAILABLE' } },
          none: { fulfillment_status: { in: ['PENDING', 'SEARCHING', 'KEPT'] } },
        },
        invoice_links: {
          some: {
            invoice: {
              deleted_at: null,
              status: { in: ['PAID', 'OVERPAID', 'REFUND_DUE'] },
              outstanding_amount: { lte: 0 },
            },
          },
        },
      },
      select: { id: true },
      take: limit,
    });

    const zeroOutstandingWaiting = await this.prisma.order.findMany({
      where: {
        deleted_at: null,
        status: 'WAITING_SETTLEMENT',
        outstanding_amount: { lte: 0 },
      },
      select: { id: true },
      take: limit,
    });

    const orderIds = [...new Set([...settledInvoiceOrders, ...zeroOutstandingWaiting].map((o) => o.id))];
    if (!orderIds.length) return { invoiceIds: [] as number[], standaloneOrderIds: [] as number[] };

    const links = await this.prisma.invoice_order.findMany({
      where: { order_id: { in: orderIds }, invoice: { deleted_at: null } },
      select: { order_id: true, invoice_id: true },
    });
    const linkedOrderIds = new Set(links.map((l) => l.order_id));

    return {
      invoiceIds: [...new Set(links.map((l) => l.invoice_id))],
      standaloneOrderIds: orderIds.filter((id) => !linkedOrderIds.has(id)),
    };
  }
}
