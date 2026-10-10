import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { FeeService } from '../shared/fee.service';
import { StockService } from '../shared/stock.service';
import { RefundService } from '../shared/refund.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { sequence } from '../../common/utils/http.utils';
import { subtotalIdr, calculateOrderTotals } from './helpers/orders-calculation.helper';
import { buildOrdersWhereClause } from './helpers/orders-query.helper';
import { createOrderItemWithProduct } from './helpers/order-item-creator.helper';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private feeService: FeeService,
    private stockService: StockService,
    private refundService: RefundService,
    private invoiceCalcService: InvoiceCalcService,
  ) { }

  async getFeePreview(amount: number, mode: string = 'AUTO_CUSTOMER') {
    const isReseller = mode === 'AUTO_RESELLER';
    const rules = await this.feeService.getFeeRules(isReseller ? 'RESELLER' : 'CUSTOMER');
    return {
      amount,
      ...this.feeService.calculateServiceFee(amount, rules),
      rules,
    };
  }

  async getSummary() {
    const counts = await this.prisma.order.groupBy({
      by: ['status'],
      where: { deleted_at: null },
      _count: { id: true },
    });
    const total = await this.prisma.order.count({ where: { deleted_at: null } });
    const summary: Record<string, number> = { TOTAL: total };
    for (const c of counts) {
      summary[c.status] = c._count.id;
    }
    return summary;
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const where = buildOrdersWhereClause(query);

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { order_date: 'desc' },
        include: {
          customer: true,
          period: true,
          items: { include: { product: true } },
          invoice_links: { include: { invoice: true } },
          admin: { select: { name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: number) {
    return this.prisma.order.findFirstOrThrow({
      where: { id, deleted_at: null },
      include: {
        customer: true,
        period: true,
        items: {
          include: {
            product: true,
            purchases: true,
            status_histories: { orderBy: { created_at: 'desc' }, include: { user: { select: { name: true } } } },
          },
        },
        payments: { where: { deleted_at: null } },
        shipments: true,
        refunds: { where: { deleted_at: null } },
        invoice_links: { include: { invoice: true } },
        admin: { select: { name: true } },
      },
    });
  }

  async create(body: any, user_id?: number) {
    if (body.period_id && body.order_date) {
      const period = await this.prisma.jastip_period.findUnique({ where: { id: Number(body.period_id) } });
      if (period?.code !== 'READY-STOCK' && period?.order_close_at && new Date(body.order_date) > new Date(period.order_close_at)) {
        throw new BadRequestException('Order date cannot be later than event order closing date.');
      }
    }

    const customer = body.customer_id
      ? await this.prisma.customer.findUnique({ where: { id: Number(body.customer_id) } })
      : null;
    const isPriorityCustomer = customer?.segment === 'PRIORITY';

    const isReseller = body.service_fee_mode === 'AUTO_RESELLER';
    const isAuto = body.service_fee_mode === 'AUTO' || body.service_fee_mode === 'AUTO_CUSTOMER' || isReseller || !body.service_fee_mode;
    const rules = await this.feeService.getFeeRules(isReseller ? 'RESELLER' : 'CUSTOMER');
    const automatic = this.feeService.calculateServiceFee(subtotalIdr(body.items || []), rules);
    const resolvedServiceFee = isAuto ? automatic.fee : (body.service_fee || 0);
    const totals = calculateOrderTotals({ ...body, service_fee: resolvedServiceFee }, body.items || []);

    const data = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          order_number: body.order_number || sequence('ORD'),
          order_date: body.order_date || new Date(),
          period_id: body.period_id,
          customer_id: body.customer_id,
          admin_id: body.admin_id || user_id,
          status: body.status || (isPriorityCustomer ? 'WAITING_PURCHASE' : 'NEW'),
          currency_code: 'IDR',
          exchange_rate: 1,
          ...totals,
          service_fee_mode: (body.service_fee_mode || 'AUTO_CUSTOMER') as any,
          service_fee_note: body.service_fee_note || null,
          customer_notes: body.customer_notes || null,
          internal_notes: body.internal_notes || null,
          due_date: body.due_date || null,
        },
      });

      for (const item of body.items || []) {
        await createOrderItemWithProduct(tx, item, order.id, body.period_id, user_id, this.stockService);
      }

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { customer: true, period: true, items: { include: { product: true } } },
      });
    });

    await this.prisma.notification.create({
      data: {
        type: 'ORDER',
        title: 'Pesanan baru dicatat',
        message: `${data.order_number} • ${data.customer.full_name} • ${data.items.length} item • Total Rp${Number(data.total_bill).toLocaleString('id-ID')}`,
        link: '/orders',
      },
    });

    const isPriority = data.customer?.segment === 'PRIORITY';
    if (isPriority || ['PURCHASED', 'WAITING_PURCHASE'].includes(data.status)) {
      await this.invoiceCalcService.ensurePurchasesForOrder(data.id);
    }

    if (['PURCHASED', 'READY_TO_SHIP'].includes(data.status)) {
      await this.invoiceCalcService.ensureShipmentForOrder(data.id);
    }

    return data;
  }

  async update(id: number, body: any, user_id?: number) {
    const current = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: { items: true, invoice_links: true, customer: true },
    });

    const checkPeriodId = body.period_id || current.period_id;
    const checkOrderDate = body.order_date || current.order_date;
    if (checkPeriodId && checkOrderDate) {
      const period = await this.prisma.jastip_period.findUnique({ where: { id: Number(checkPeriodId) } });
      if (period?.code !== 'READY-STOCK' && period?.order_close_at && new Date(checkOrderDate) > new Date(period.order_close_at)) {
        throw new BadRequestException('Order date cannot be later than event order closing date.');
      }
    }

    const items = body.items || current.items;
    const service_fee_mode = body.service_fee_mode ?? current.service_fee_mode;
    const isReseller = service_fee_mode === 'AUTO_RESELLER';
    const isAuto = service_fee_mode === 'AUTO' || service_fee_mode === 'AUTO_CUSTOMER' || isReseller;
    const rules = await this.feeService.getFeeRules(isReseller ? 'RESELLER' : 'CUSTOMER');
    const automatic = this.feeService.calculateServiceFee(subtotalIdr(items), rules);
    const resolvedServiceFee = isAuto ? automatic.fee : (body.service_fee ?? current.service_fee);
    const totals = calculateOrderTotals({ ...current, ...body, service_fee: resolvedServiceFee }, items);

    const data = await this.prisma.$transaction(async (tx) => {
      if (body.items) {
        for (const oldItem of current.items) {
          if (oldItem.source_type === 'READY_STOCK' && oldItem.product_id && !['UNAVAILABLE', 'SHIPPED', 'DELIVERED'].includes(oldItem.fulfillment_status)) {
            await this.stockService.releaseReadyStock(tx, oldItem.product_id, oldItem.quantity, user_id, String(oldItem.id), 'Reservasi dilepas karena pembaruan pesanan.');
          }
        }
        await tx.order_item.deleteMany({ where: { order_id: id } });

        for (const item of body.items) {
          await createOrderItemWithProduct(tx, item, id, body.period_id || current.period_id, user_id, this.stockService);
        }
      }

      const updated = await tx.order.update({
        where: { id },
        data: {
          ...body,
          ...totals,
          items: undefined,
          service_fee_mode,
        },
        include: { customer: true, period: true, items: { include: { product: true } }, invoice_links: true },
      });

      if (updated.invoice_links?.[0]?.invoice_id) {
        await tx.invoice_order.updateMany({
          where: { order_id: id },
          data: { snapshot_amount: updated.total_bill },
        });
      }

      return updated;
    });

    if (data.invoice_links?.[0]?.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(data.invoice_links[0].invoice_id);
    } else {
      await this.invoiceCalcService.refreshOrderPayment(id);
    }

    const isPriority = data.customer?.segment === 'PRIORITY';
    if (isPriority || ['PURCHASED', 'WAITING_PURCHASE'].includes(data.status)) {
      await this.invoiceCalcService.ensurePurchasesForOrder(data.id);
    }

    if (['PURCHASED', 'READY_TO_SHIP'].includes(data.status)) {
      await this.invoiceCalcService.ensureShipmentForOrder(data.id);
    }

    return data;
  }

  async remove(id: number, user_id?: number) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: { items: true, invoice_links: true },
    });

    for (const item of order.items) {
      if (item.source_type === 'READY_STOCK' && item.product_id && !['UNAVAILABLE', 'SHIPPED', 'DELIVERED'].includes(item.fulfillment_status)) {
        await this.stockService.releaseReadyStock(this.prisma, item.product_id, item.quantity, user_id, String(item.id), 'Stok dilepas karena pesanan dihapus.');
      }
    }

    await this.prisma.order.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });

    if (order.invoice_links?.[0]?.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(order.invoice_links[0].invoice_id);
    }
    return { success: true };
  }
}
