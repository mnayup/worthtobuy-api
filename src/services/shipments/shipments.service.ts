import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { StockService } from '../shared/stock.service';
import {
  isOrderFullyPaid,
  validateShipmentPaymentPreconditions,
  validateShipmentTransition,
} from './helpers/shipment-sync.helper';

@Injectable()
export class ShipmentsService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
  ) { }

  private async syncItems(order_id: number, shipmentStatus: string, user_id?: number) {
    const isDelivered = shipmentStatus === 'DELIVERED' || shipmentStatus === 'COMPLETED';
    const isShipped = ['HANDED_TO_COURIER', 'IN_TRANSIT', 'SHIPPED'].includes(shipmentStatus);
    const nextStatus = isDelivered ? 'DELIVERED' : isShipped ? 'SHIPPED' : null;
    if (!nextStatus) return;

    const items = await this.prisma.order_item.findMany({ where: { order_id } });
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (['SHIPPED', 'DELIVERED'].includes(item.fulfillment_status) && nextStatus === 'SHIPPED') continue;
        if (item.source_type === 'READY_STOCK' && item.product_id && !['SHIPPED', 'DELIVERED'].includes(item.fulfillment_status)) {
          await this.stockService.consumeReadyStock(tx, item.product_id, item.quantity, user_id, String(item.id));
        }
        await tx.order_item.update({
          where: { id: item.id },
          data: { fulfillment_status: nextStatus as any, status_updated_at: new Date() },
        });
        await tx.item_status_history.create({
          data: {
            order_item_id: item.id,
            from_status: item.fulfillment_status,
            to_status: nextStatus as any,
            notes: `Sinkron dari status pengiriman ${shipmentStatus}.`,
            user_id,
          },
        });
      }
      await tx.order.update({ where: { id: order_id }, data: { status: isDelivered ? 'COMPLETED' : 'SHIPPED' } });
    });
  }

  async getSummary() {
    const shipments = await this.prisma.shipment.findMany({ select: { status: true } });
    const summary: Record<string, number> = {
      TOTAL: shipments.length,
      WAITING_PACKING: 0,
      PACKED: 0,
      READY: 0,
      HANDED_TO_COURIER: 0,
      IN_TRANSIT: 0,
      DELIVERED: 0,
      FAILED: 0,
      RETURNED: 0,
    };
    shipments.forEach((s) => {
      if (summary[s.status] !== undefined) summary[s.status]++;
    });
    return summary;
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim().slice(0, 100);
    const status = query.status && query.status !== 'ALL' ? String(query.status) : undefined;
    const courierFilter = query.courier && query.courier !== 'ALL' ? String(query.courier) : undefined;

    const where: any = {
      order: { deleted_at: null },
      ...(status ? { status } : {}),
      ...(courierFilter ? { courier: { contains: courierFilter, mode: 'insensitive' } } : {}),
      ...(search
        ? {
          OR: [
            { tracking_number: { contains: search, mode: 'insensitive' } },
            { courier: { contains: search, mode: 'insensitive' } },
            { customer: { full_name: { contains: search, mode: 'insensitive' } } },
            { customer: { customer_code: { contains: search, mode: 'insensitive' } } },
            { customer: { whatsapp: { contains: search } } },
            { order: { order_number: { contains: search, mode: 'insensitive' } } },
            { address: { contains: search, mode: 'insensitive' } },
            { service_type: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
            { order: { items: { some: { product: { name: { contains: search, mode: 'insensitive' } } } } } },
            { order: { items: { some: { manual_product_name: { contains: search, mode: 'insensitive' } } } } },
          ],
        }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customer: true,
          order: {
            include: {
              items: { include: { product: true } },
              invoice_links: { include: { invoice: true } },
            },
          },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: number) {
    return this.prisma.shipment.findUniqueOrThrow({
      where: { id },
      include: {
        customer: true,
        order: {
          include: {
            items: { include: { product: true } },
            invoice_links: { include: { invoice: true } },
          },
        },
      },
    });
  }

  async create(body: any, user_id?: number) {
    let status = body.status || 'WAITING_PACKING';
    if (status === 'COMPLETED') status = 'DELIVERED';
    body.status = status;

    if (body.order_id) {
      const order = await this.prisma.order.findUnique({
        where: { id: body.order_id },
        include: { invoice_links: { include: { invoice: true } } },
      });
      validateShipmentPaymentPreconditions(order, status, body.tracking_number);
    }

    const data = await this.prisma.shipment.create({ data: body });
    await this.syncItems(data.order_id, data.status, user_id);
    return data;
  }

  async update(id: number, body: any, user_id?: number) {
    const current = await this.prisma.shipment.findUniqueOrThrow({
      where: { id },
      include: {
        order: {
          include: {
            invoice_links: { include: { invoice: true } },
          },
        },
      },
    });

    let targetStatus = body.status !== undefined ? body.status : current.status;
    if (targetStatus === 'COMPLETED') {
      targetStatus = 'DELIVERED';
      body.status = 'DELIVERED';
    }

    const isPackingAttempt =
      (body.status === 'PACKED' || targetStatus === 'PACKED' || targetStatus === 'READY') &&
      current.status === 'WAITING_PACKING';
    const isSetResiAttempt =
      (body.tracking_number !== undefined &&
        String(body.tracking_number).trim() !== '' &&
        body.tracking_number !== current.tracking_number) ||
      (['IN_TRANSIT', 'HANDED_TO_COURIER'].includes(targetStatus) &&
        !['IN_TRANSIT', 'HANDED_TO_COURIER', 'DELIVERED'].includes(current.status));

    if (isPackingAttempt || isSetResiAttempt) {
      if (!isOrderFullyPaid(current.order)) {
        if (isPackingAttempt) {
          throw new BadRequestException('Pesanan belum lunas (Full Payment). Proses packing tidak dapat dilakukan sebelum pembayaran lunas.');
        }
        if (isSetResiAttempt) {
          throw new BadRequestException('Pesanan belum lunas (Full Payment). Penginputan nomor resi tidak dapat dilakukan sebelum pembayaran lunas.');
        }
      }
    }

    validateShipmentTransition(targetStatus, current, body);

    const data = await this.prisma.shipment.update({ where: { id }, data: body });
    if (body.status) await this.syncItems(data.order_id, body.status, user_id);
    return data;
  }

  async ensureShipmentForOrder(order_id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: order_id },
      include: {
        customer: true,
        shipments: true,
        items: { include: { product: true } },
      },
    });
    if (!order) return null;

    if (order.shipments && order.shipments.length > 0) {
      return order.shipments[0];
    }

    const address = order.customer?.address && order.customer?.address.trim() !== '-'
      ? order.customer.address.trim()
      : '-';

    const itemsSummary = order.items && order.items.length > 0
      ? order.items
          .map(
            (i) =>
              `${i.quantity}x ${i.product?.name || i.manual_product_name || 'Item'}${
                i.variation ? ` (${i.variation})` : ''
              }${i.size ? ` (${i.size})` : ''}${i.color ? ` [${i.color}]` : ''}`
          )
          .join(', ')
      : '';

    return this.prisma.shipment.create({
      data: {
        order_id: order.id,
        customer_id: order.customer_id,
        address,
        courier: 'JNE',
        service_type: null,
        tracking_number: null,
        shipping_cost: order.customer_shipping || 0,
        status: 'WAITING_PACKING',
        notes: itemsSummary
          ? `Item to pack: ${itemsSummary}`
          : `Pengiriman otomatis dibuat untuk pesanan ${order.order_number}.`,
      },
    });
  }
}
