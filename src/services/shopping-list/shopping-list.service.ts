import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { StockService } from '../shared/stock.service';
import { RefundService } from '../shared/refund.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';

@Injectable()
export class ShoppingListService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
    private refundService: RefundService,
    private invoiceCalcService: InvoiceCalcService,
  ) { }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const period_id = query.period_id ? Number(query.period_id) : undefined;
    const brand = String(query.brand || query.store || '').trim().slice(0, 100);
    const search = String(query.search || '').trim().slice(0, 100);
    const status = query.status ? String(query.status) : undefined;

    const where: any = {
      ...(status ? { purchase_status: status as any } : {}),
      order: { deleted_at: null, ...(period_id ? { period_id } : {}) },
      ...(brand
        ? {
          OR: [
            { brand_name: { contains: brand, mode: 'insensitive' } },
            { product: { brand_name: { contains: brand, mode: 'insensitive' } } },
          ],
        }
        : {}),
      ...(search
        ? {
          OR: [
            { manual_product_name: { contains: search, mode: 'insensitive' } },
            { brand_name: { contains: search, mode: 'insensitive' } },
            { variation: { contains: search, mode: 'insensitive' } },
            { size: { contains: search, mode: 'insensitive' } },
            { color: { contains: search, mode: 'insensitive' } },
            { purchase_notes: { contains: search, mode: 'insensitive' } },
            { product: { name: { contains: search, mode: 'insensitive' } } },
            { product: { sku: { contains: search, mode: 'insensitive' } } },
            { product: { brand_name: { contains: search, mode: 'insensitive' } } },
            { product: { store_location: { contains: search, mode: 'insensitive' } } },
            { order: { order_number: { contains: search, mode: 'insensitive' } } },
            { order: { customer: { full_name: { contains: search, mode: 'insensitive' } } } },
            { order: { customer: { whatsapp: { contains: search } } } },
            { order: { period: { code: { contains: search, mode: 'insensitive' } } } },
            { order: { period: { name: { contains: search, mode: 'insensitive' } } } },
          ],
        }
        : {}),
      source_type: { not: 'READY_STOCK' },
    };

    const [data, total] = await Promise.all([
      this.prisma.order_item.findMany({
        where,
        skip,
        take: limit,
        include: { product: true, order: { include: { customer: true, period: true } } },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.order_item.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async updateStatus(id: number, input: { purchase_status: string; purchase_notes?: string | null }, user_id?: number) {
    const current = await this.prisma.order_item.findUniqueOrThrow({ where: { id } });
    const fulfillment_status =
      input.purchase_status === 'OUT_OF_STOCK'
        ? 'UNAVAILABLE'
        : ['FOUND', 'PURCHASED', 'REPLACED'].includes(input.purchase_status)
          ? 'AVAILABLE'
          : input.purchase_status === 'PENDING'
            ? 'PENDING'
            : current.fulfillment_status;

    const data = await this.prisma.$transaction(async tx => {
      if (input.purchase_status === 'OUT_OF_STOCK' && current.source_type === 'READY_STOCK' && current.product_id && current.fulfillment_status !== 'UNAVAILABLE') {
        await this.stockService.releaseReadyStock(tx, current.product_id, current.quantity, user_id, String(current.id), 'Barang ditandai habis dari daftar belanja.');
      }
      const updated = await tx.order_item.update({
        where: { id },
        data: { purchase_status: input.purchase_status as any, purchase_notes: input.purchase_notes, fulfillment_status: fulfillment_status as any, status_updated_at: new Date() },
      });
      if (fulfillment_status !== current.fulfillment_status) {
        await tx.item_status_history.create({
          data: { order_item_id: id, from_status: current.fulfillment_status, to_status: fulfillment_status as any, notes: input.purchase_notes, user_id },
        });
      }
      return updated;
    });

    if (input.purchase_status === 'OUT_OF_STOCK') {
      await this.refundService.ensureUnavailableItemRefund(id);
    } else if (current.fulfillment_status === 'UNAVAILABLE') {
      await this.refundService.removeUnavailableItemRefund(id);
    }

    await this.invoiceCalcService.refreshPaymentTarget({ order_id: current.order_id });
    return data;
  }
}
