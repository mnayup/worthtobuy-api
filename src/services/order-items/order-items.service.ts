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
    const period_id = query.period_id ? Number(query.period_id) : query.periodId ? Number(query.periodId) : undefined;
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

  async updateStatus(id: number, input: { status: string; kept_until?: Date | null; keptUntil?: Date | null; notes?: string | null }, user_id?: number) {
    const current = await this.prisma.order_item.findUniqueOrThrow({ where: { id }, include: { product: true } });
    const rawKeptUntil = input.kept_until !== undefined ? input.kept_until : input.keptUntil;
    const kept_until = input.status === 'KEPT' && rawKeptUntil ? new Date(rawKeptUntil) : null;

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
          kept_until,
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

  async getKeptCustomers(query: any) {
    const search = String(query.search || '').trim();
    const urgency = String(query.urgency || 'ALL').trim();

    const items = await this.prisma.order_item.findMany({
      where: {
        fulfillment_status: 'KEPT',
        order: {
          deleted_at: null,
          outstanding_amount: { lte: 0 },
        },
      },
      include: {
        product: true,
        order: {
          include: {
            customer: true,
            period: true,
            shipments: true,
          },
        },
      },
      orderBy: [{ kept_until: 'asc' }, { id: 'desc' }],
    });

    const now = Date.now();
    let totalItems = 0;
    let expiringSoonCount = 0;
    let expiredCount = 0;

    const customerMap = new Map<number, any>();

    for (const it of items) {
      const cust = it.order.customer;
      if (!cust) continue;

      const keptDate = it.kept_until
        ? new Date(it.kept_until)
        : new Date(now + 30 * 86400000);
      const remainingDays = Math.ceil(
        (keptDate.getTime() - now) / (1000 * 60 * 60 * 24)
      );

      totalItems += it.quantity;
      if (remainingDays < 0) {
        expiredCount += it.quantity;
      } else if (remainingDays <= 7) {
        expiringSoonCount += it.quantity;
      }

      if (!customerMap.has(cust.id)) {
        customerMap.set(cust.id, {
          id: cust.id,
          full_name: cust.full_name || 'Customer',
          whatsapp: cust.whatsapp || '',
          segment: cust.segment || 'REGULAR',
          address: cust.address || '-',
          total_kept_quantity: 0,
          items: [],
        });
      }

      const cGroup = customerMap.get(cust.id);
      cGroup.total_kept_quantity += it.quantity;
      cGroup.items.push({
        id: it.id,
        order_item_id: it.id,
        product_id: it.product_id,
        product_name: it.product?.name || it.manual_product_name || 'Item',
        brand_name: it.product?.brand_name || it.brand_name || '-',
        image_url: it.product?.image_url || it.photo_url || null,
        variation: it.variation || null,
        size: it.size || null,
        color: it.color || null,
        quantity: it.quantity,
        unit_price_foreign: Number(it.unit_price_foreign || 0),
        order_id: it.order_id,
        order_number: it.order.order_number,
        order_date: it.order.order_date,
        period_name: it.order.period?.name || '-',
        period_code: it.order.period?.code || '-',
        kept_until: it.kept_until || keptDate.toISOString(),
        remaining_days: remainingDays,
        fulfillment_status: it.fulfillment_status,
      });
    }

    let customerList = Array.from(customerMap.values());

    if (search) {
      const s = search.toLowerCase();
      customerList = customerList.filter(
        (c) =>
          c.full_name.toLowerCase().includes(s) ||
          c.whatsapp.includes(s) ||
          c.items.some(
            (i: any) =>
              i.product_name.toLowerCase().includes(s) ||
              i.order_number.toLowerCase().includes(s) ||
              i.brand_name.toLowerCase().includes(s)
          )
      );
    }

    if (urgency === 'EXPIRED') {
      customerList = customerList.filter((c) =>
        c.items.some((i: any) => i.remaining_days < 0)
      );
    } else if (urgency === 'EXPIRING_SOON') {
      customerList = customerList.filter((c) =>
        c.items.some((i: any) => i.remaining_days >= 0 && i.remaining_days <= 7)
      );
    } else if (urgency === 'ACTIVE') {
      customerList = customerList.filter((c) =>
        c.items.some((i: any) => i.remaining_days > 7)
      );
    }

    return {
      customers: customerList,
      summary: {
        totalCustomers: customerMap.size,
        totalItems,
        expiringSoonCount,
        expiredCount,
      },
    };
  }

  async moveToShipment(itemIds: number[], user_id?: number) {
    if (!itemIds || !itemIds.length) return { success: false, count: 0 };
    const validIds = itemIds.map(Number).filter(Boolean);

    const items = await this.prisma.order_item.findMany({
      where: { id: { in: validIds } },
      include: { order: { include: { customer: true } } },
    });

    const affectedOrderIds = new Set<number>();

    for (const it of items) {
      affectedOrderIds.add(it.order_id);
      await this.prisma.order_item.update({
        where: { id: it.id },
        data: {
          fulfillment_status: 'READY_TO_SHIP',
          status_updated_at: new Date(),
        },
      });

      await this.prisma.item_status_history.create({
        data: {
          order_item_id: it.id,
          from_status: it.fulfillment_status,
          to_status: 'READY_TO_SHIP',
          notes:
            'Item dipindahkan dari Titip Simpan (KEPT) ke Pengiriman (READY_TO_SHIP).',
          user_id,
        },
      });
    }

    for (const orderId of affectedOrderIds) {
      await this.refreshOrderItemSummary(orderId);
      await this.invoiceCalcService.ensureShipmentForOrder(orderId);
    }

    return { success: true, count: validIds.length };
  }
}
