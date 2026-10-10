import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { StockService } from '../shared/stock.service';
import { RefundService } from '../shared/refund.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';

@Injectable()
export class OrderItemsService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
    private refundService: RefundService,
    private invoiceCalcService: InvoiceCalcService,
  ) { }

  private async refreshOrderItemSummary(order_id: number) {
    const items = await this.prisma.order_item.findMany({ where: { order_id }, select: { fulfillment_status: true } });
    if (!items.length) return;
    const statuses = items.map(item => item.fulfillment_status);
    let status: any = undefined;
    if (statuses.every(value => value === 'DELIVERED')) status = 'COMPLETED';
    else if (statuses.every(value => ['SHIPPED', 'DELIVERED'].includes(value))) status = 'SHIPPED';
    else if (statuses.every(value => value === 'UNAVAILABLE')) status = 'UNAVAILABLE';
    else if (statuses.some(value => value === 'KEPT')) status = 'PURCHASED';
    else if (statuses.every(value => ['AVAILABLE', 'READY_TO_SHIP'].includes(value))) status = 'READY_TO_SHIP';
    else if (statuses.some(value => value === 'AVAILABLE')) status = 'PURCHASED';
    else if (statuses.some(value => value === 'SEARCHING')) status = 'SEARCHING';
    if (status) {
      await this.prisma.order.update({ where: { id: order_id }, data: { status } });
      if (['PURCHASED', 'READY_TO_SHIP'].includes(status)) {
        await this.invoiceCalcService.ensureShipmentForOrder(order_id);
      }
    }
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const status = query.status ? String(query.status) : undefined;
    const availability = query.availability ? String(query.availability) : undefined;
    const shipping = query.shipping ? String(query.shipping) : undefined;
    const period_id = query.period_id ? Number(query.period_id) : undefined;
    const search = String(query.search || '').trim().slice(0, 100);

    const statusFilter = status
      ? { fulfillment_status: status as any }
      : availability === 'available'
        ? { fulfillment_status: { in: ['AVAILABLE', 'KEPT', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'] as any } }
        : availability === 'unavailable'
          ? { fulfillment_status: 'UNAVAILABLE' as any }
          : shipping === 'shipped'
            ? { fulfillment_status: { in: ['SHIPPED', 'DELIVERED'] as any } }
            : shipping === 'unshipped'
              ? { fulfillment_status: { notIn: ['SHIPPED', 'DELIVERED'] as any } }
              : {};

    const where: any = {
      ...statusFilter,
      order: { deleted_at: null, ...(period_id ? { period_id } : {}) },
      ...(search
        ? {
          OR: [
            { manual_product_name: { contains: search, mode: 'insensitive' } },
            { brand_name: { contains: search, mode: 'insensitive' } },
            { product: { name: { contains: search, mode: 'insensitive' } } },
            { product: { sku: { contains: search, mode: 'insensitive' } } },
            { product: { brand_name: { contains: search, mode: 'insensitive' } } },
            { variation: { contains: search, mode: 'insensitive' } },
            { size: { contains: search, mode: 'insensitive' } },
            { color: { contains: search, mode: 'insensitive' } },
            { purchase_notes: { contains: search, mode: 'insensitive' } },
            { order: { order_number: { contains: search, mode: 'insensitive' } } },
            { order: { customer: { full_name: { contains: search, mode: 'insensitive' } } } },
            { order: { customer: { whatsapp: { contains: search } } } },
            { order: { period: { code: { contains: search, mode: 'insensitive' } } } },
            { order: { period: { name: { contains: search, mode: 'insensitive' } } } },
          ],
        }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.order_item.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ status_updated_at: 'desc' }, { created_at: 'desc' }],
        include: {
          product: true,
          order: { include: { customer: true, period: true, shipments: true } },
          status_histories: { orderBy: { created_at: 'desc' }, take: 5, include: { user: { select: { name: true } } } },
        },
      }),
      this.prisma.order_item.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findHistory(id: number) {
    return this.prisma.item_status_history.findMany({
      where: { order_item_id: id },
      orderBy: { created_at: 'desc' },
      include: { user: { select: { name: true } } },
    });
  }

  async updateStatus(id: number, input: { status: string; kept_until?: Date | null; notes?: string | null }, user_id?: number) {
    const current = await this.prisma.order_item.findUniqueOrThrow({ where: { id }, include: { product: true } });

    const data = await this.prisma.$transaction(async tx => {
      const wasFinalized = ['SHIPPED', 'DELIVERED'].includes(current.fulfillment_status);
      const willFinalize = ['SHIPPED', 'DELIVERED'].includes(input.status);

      if (current.source_type === 'READY_STOCK' && current.product_id) {
        if (!wasFinalized && willFinalize) {
          await this.stockService.consumeReadyStock(tx, current.product_id, current.quantity, user_id, String(current.id));
        } else if (current.fulfillment_status !== 'UNAVAILABLE' && input.status === 'UNAVAILABLE') {
          await this.stockService.releaseReadyStock(tx, current.product_id, current.quantity, user_id, String(current.id), 'Barang ready stock dibatalkan/tidak tersedia.');
        } else if (current.fulfillment_status === 'UNAVAILABLE' && !['UNAVAILABLE', 'SHIPPED', 'DELIVERED'].includes(input.status)) {
          await this.stockService.reserveReadyStock(tx, current.product_id, current.quantity, user_id, String(current.id));
        }
      }

      const updated = await tx.order_item.update({
        where: { id },
        data: {
          fulfillment_status: input.status as any,
          kept_until: input.status === 'KEPT' ? input.kept_until : null,
          status_updated_at: new Date(),
          ...(input.status === 'UNAVAILABLE' ? { purchase_status: 'OUT_OF_STOCK' } : {}),
          ...(['AVAILABLE', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'].includes(input.status) ? { purchase_status: 'PURCHASED' } : {}),
        },
        include: { product: true, order: { include: { customer: true, period: true, shipments: true } } },
      });

      await tx.item_status_history.create({
        data: {
          order_item_id: id,
          from_status: current.fulfillment_status,
          to_status: input.status as any,
          notes: input.notes,
          user_id,
        },
      });

      return updated;
    });

    if (input.status === 'UNAVAILABLE') {
      await this.refundService.ensureUnavailableItemRefund(id);
    } else if (current.fulfillment_status === 'UNAVAILABLE') {
      await this.refundService.removeUnavailableItemRefund(id);
    }

    await this.invoiceCalcService.refreshPaymentTarget({ order_id: data.order_id });
    await this.refreshOrderItemSummary(data.order_id);
    return data;
  }
}
