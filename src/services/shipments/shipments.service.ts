import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { StockService } from '../shared/stock.service';
import { RefundService } from '../shared/refund.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { cleanShipmentData } from './helpers/shipment-cleaner.helper';
import { processShippingCostVariance } from './helpers/shipment-variance.helper';
import {
  isOrderFullyPaid,
  validateShipmentPaymentPreconditions,
  validateShipmentTransition,
} from './helpers/shipment-sync.helper';
import { ensureShipmentForOrderHelper } from '../shared/helpers/order-fulfillment.helper';

@Injectable()
export class ShipmentsService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
    private refundService: RefundService,
    private invoiceCalcService: InvoiceCalcService,
  ) { }

  private async syncItems(order_id: number, shipmentStatus: string, user_id?: number) {
    const isDelivered = shipmentStatus === 'DELIVERED' || shipmentStatus === 'COMPLETED';
    const isShipped = ['HANDED_TO_COURIER', 'IN_TRANSIT', 'SHIPPED'].includes(shipmentStatus);
    const nextStatus = isDelivered ? 'DELIVERED' : isShipped ? 'SHIPPED' : null;

    if (!nextStatus) {
      if (shipmentStatus === 'WAITING_SETTLEMENT') {
        await this.prisma.order.update({
          where: { id: order_id },
          data: { status: 'WAITING_SETTLEMENT' },
        });
      }
      return;
    }

    const items = await this.prisma.order_item.findMany({ where: { order_id } });
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (
          ['SHIPPED', 'DELIVERED'].includes(item.fulfillment_status) &&
          nextStatus === 'SHIPPED'
        ) {
          continue;
        }
        if (
          item.source_type === 'READY_STOCK' &&
          item.product_id &&
          !['SHIPPED', 'DELIVERED'].includes(item.fulfillment_status)
        ) {
          await this.stockService.consumeReadyStock(
            tx,
            item.product_id,
            item.quantity,
            user_id,
            String(item.id)
          );
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
      await tx.order.update({
        where: { id: order_id },
        data: { status: isDelivered ? 'COMPLETED' : 'SHIPPED' },
      });
    });
  }

  async getSummary() {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        order: { deleted_at: null },
      },
      select: { status: true },
    });
    const summary: Record<string, number> = {
      TOTAL: shipments.length,
      WAITING_PACKING: 0,
      PACKED: 0,
      READY: 0,
      HANDED_TO_COURIER: 0,
      IN_TRANSIT: 0,
      WAITING_SETTLEMENT: 0,
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
    const courierFilter =
      query.courier && query.courier !== 'ALL' ? String(query.courier) : undefined;

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
            { shipment_orders: { some: { order: { order_number: { contains: search, mode: 'insensitive' } } } } },
            { address: { contains: search, mode: 'insensitive' } },
            { service_type: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
            {
              order: {
                items: { some: { product: { name: { contains: search, mode: 'insensitive' } } } },
              },
            },
            {
              order: {
                items: {
                  some: { manual_product_name: { contains: search, mode: 'insensitive' } },
                },
              },
            },
            {
              shipment_orders: {
                some: {
                  order: {
                    items: {
                      some: { product: { name: { contains: search, mode: 'insensitive' } } },
                    },
                  },
                },
              },
            },
            {
              shipment_orders: {
                some: {
                  order: {
                    items: {
                      some: { manual_product_name: { contains: search, mode: 'insensitive' } },
                    },
                  },
                },
              },
            },
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
          shipping_counter: true,
          order: {
            include: {
              items: { include: { product: true } },
              invoice_links: { include: { invoice: true } },
            },
          },
          shipment_orders: {
            include: {
              order: {
                include: {
                  items: { include: { product: true } },
                  invoice_links: { include: { invoice: true } },
                },
              },
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
        shipping_counter: true,
        order: {
          include: {
            items: { include: { product: true } },
            invoice_links: { include: { invoice: true } },
          },
        },
        shipment_orders: {
          include: {
            order: {
              include: {
                items: { include: { product: true } },
                invoice_links: { include: { invoice: true } },
              },
            },
          },
        },
      },
    });
  }

  async create(body: any, user_id?: number) {
    const cleaned = cleanShipmentData(body);
    const status = cleaned.status || 'WAITING_PACKING';
    cleaned.status = status;

    if (cleaned.order_id) {
      const order = await this.prisma.order.findUnique({
        where: { id: cleaned.order_id },
        include: { invoice_links: { include: { invoice: true } } },
      });
      validateShipmentPaymentPreconditions(order, status, cleaned.tracking_number);
    }

    const data = await this.prisma.shipment.create({ data: cleaned });
    if (data.order_id) {
      await this.prisma.shipment_order.upsert({
        where: {
          shipment_id_order_id: {
            shipment_id: data.id,
            order_id: data.order_id,
          },
        },
        create: {
          shipment_id: data.id,
          order_id: data.order_id,
        },
        update: {},
      });
      await this.syncItems(data.order_id, data.status, user_id);
    }
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
        shipment_orders: {
          include: {
            order: {
              include: {
                invoice_links: { include: { invoice: true } },
              },
            },
          },
        },
      },
    });

    const cleaned = cleanShipmentData(body);
    let targetStatus = cleaned.status !== undefined ? cleaned.status : current.status;
    if (targetStatus === 'COMPLETED') {
      targetStatus = 'DELIVERED';
      cleaned.status = 'DELIVERED';
    }

    const isPackingAttempt =
      (cleaned.status === 'PACKED' || targetStatus === 'PACKED' || targetStatus === 'READY') &&
      current.status === 'WAITING_PACKING';
    const isSetResiAttempt =
      (cleaned.tracking_number !== undefined &&
        String(cleaned.tracking_number).trim() !== '' &&
        cleaned.tracking_number !== current.tracking_number) ||
      (['IN_TRANSIT', 'HANDED_TO_COURIER'].includes(targetStatus) &&
        !['IN_TRANSIT', 'HANDED_TO_COURIER', 'DELIVERED'].includes(current.status));

    if (isPackingAttempt || isSetResiAttempt) {
      const allOrdersToCheck = [
        current.order,
        ...(current.shipment_orders || []).map((so) => so.order),
      ].filter(Boolean);

      const hasUnpaidOrder = allOrdersToCheck.some((ord) => !isOrderFullyPaid(ord));
      if (hasUnpaidOrder) {
        if (isPackingAttempt) {
          throw new BadRequestException(
            'Pesanan belum lunas (Full Payment). ' +
              'Proses packing tidak dapat dilakukan sebelum pembayaran lunas.'
          );
        }
        if (isSetResiAttempt) {
          throw new BadRequestException(
            'Pesanan belum lunas (Full Payment). ' +
              'Penginputan nomor resi tidak dapat dilakukan sebelum pembayaran lunas.'
          );
        }
      }
    }

    validateShipmentTransition(targetStatus, current, cleaned);

    if (targetStatus === 'PACKED' && !cleaned.packed_at) {
      cleaned.packed_at = new Date();
    }

    const effectiveCourier = cleaned.courier !== undefined ? cleaned.courier : current.courier || '';
    const isShopee =
      cleaned.shipping_method === 'SHOPEE' ||
      (cleaned.shipping_method === undefined && current.shipping_method === 'SHOPEE') ||
      effectiveCourier.toLowerCase().includes('shopee');

    if (isShopee) {
      if (cleaned.shopee_refund_amount !== undefined && cleaned.shopee_refund_amount !== null) {
        await this.refundService.ensureShopeeRefund(
          current.id,
          current.order_id,
          Number(cleaned.shopee_refund_amount),
          cleaned.notes
        );
      }
      if (cleaned.tracking_number && ['WAITING_PACKING', 'PACKED', 'READY'].includes(current.status)) {
        if (!cleaned.status) {
          cleaned.status = 'IN_TRANSIT';
          targetStatus = 'IN_TRANSIT';
        }
      }
    } else {
      // Switched away from Shopee: clear Shopee data and cancel any pending Shopee refund
      cleaned.shopee_refund_amount = null;
      cleaned.shopee_username = null;
      cleaned.shipping_method = 'MANUAL';
      await this.refundService.ensureShopeeRefund(current.id, current.order_id, 0);

      if (cleaned.actual_shipping_cost !== undefined && cleaned.actual_shipping_cost !== null) {
        targetStatus = await processShippingCostVariance({
          prisma: this.prisma,
          refundService: this.refundService,
          invoiceCalcService: this.invoiceCalcService,
          current,
          cleaned,
          targetStatus,
        });
      }
    }

    const data = await this.prisma.shipment.update({ where: { id }, data: cleaned });
    if (cleaned.status) {
      const orderIdsToSync = Array.from(
        new Set([
          data.order_id,
          ...(current.shipment_orders || []).map((so) => so.order_id),
        ])
      ).filter(Boolean);

      for (const ordId of orderIdsToSync) {
        await this.syncItems(ordId, cleaned.status, user_id);
      }
    }
    return data;
  }

  async merge(
    body: {
      shipment_ids: number[];
      address?: string;
      courier?: string;
      service_type?: string;
      notes?: string;
    },
    user_id?: number
  ) {
    const rawIds = body.shipment_ids || [];
    const shipmentIds = rawIds.map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0);

    if (shipmentIds.length < 2) {
      throw new BadRequestException('Pilih minimal 2 pengiriman untuk digabungkan.');
    }

    const shipments = await this.prisma.shipment.findMany({
      where: { id: { in: shipmentIds } },
      include: {
        customer: true,
        order: {
          include: {
            items: { include: { product: true } },
            invoice_links: { include: { invoice: true } },
          },
        },
        shipment_orders: {
          include: {
            order: {
              include: {
                items: { include: { product: true } },
                invoice_links: { include: { invoice: true } },
              },
            },
          },
        },
      },
    });

    if (shipments.length !== shipmentIds.length) {
      throw new BadRequestException('Beberapa data pengiriman yang dipilih tidak ditemukan.');
    }

    // 1. Verify all shipments belong to the exact same customer
    const firstCustomerId = shipments[0].customer_id;
    const isSameCustomer = shipments.every((s) => s.customer_id === firstCustomerId);
    if (!isSameCustomer) {
      throw new BadRequestException(
        'Penggabungan pengiriman hanya dapat dilakukan untuk pelanggan yang sama.'
      );
    }

    // 2. Verify all shipments are not yet packed (WAITING_PACKING and packed_at is null)
    const hasPacked = shipments.some(
      (s) => s.status !== 'WAITING_PACKING' || Boolean(s.packed_at)
    );
    if (hasPacked) {
      throw new BadRequestException(
        'Penggabungan pengiriman hanya dapat dilakukan jika semua status pengiriman belum dipacking (Menunggu Packing).'
      );
    }

    const primary = shipments[0];
    const secondaryShipments = shipments.slice(1);

    // Collect all orders across all shipments
    const ordersMap = new Map<number, any>();
    for (const s of shipments) {
      if (s.order) ordersMap.set(s.order.id, s.order);
      for (const so of s.shipment_orders || []) {
        if (so.order) ordersMap.set(so.order.id, so.order);
      }
    }
    const allOrders = Array.from(ordersMap.values());
    const allOrderIds = Array.from(ordersMap.keys());

    // Sum shipping costs
    const totalShippingCost = shipments.reduce(
      (acc, s) => acc + Number(s.shipping_cost || 0),
      0
    );

    // Build consolidated items notes
    const allItems = allOrders.flatMap((o) => o.items || []);
    const itemsSummary = allItems
      .map(
        (i) =>
          `${i.quantity}x ${i.product?.name || i.manual_product_name || 'Item'}${
            i.variation ? ` (${i.variation})` : ''
          }${i.size ? ` (${i.size})` : ''}${i.color ? ` [${i.color}]` : ''}`
      )
      .join(', ');

    const orderNumbersList = allOrders
      .map((o) => o.order_number)
      .filter(Boolean)
      .join(', ');

    const finalAddress =
      body.address?.trim() ||
      primary.address ||
      primary.customer?.address ||
      '-';

    const finalCourier = body.courier?.trim() || primary.courier || 'JNE';
    const finalServiceType =
      body.service_type !== undefined ? body.service_type : primary.service_type;

    const mergedNotes =
      body.notes?.trim() ||
      `Penggabungan pesanan: ${orderNumbersList}.\nItem to pack: ${itemsSummary}`;

    return await this.prisma.$transaction(async (tx) => {
      // 1. Link all orders to primary shipment in shipment_orders
      for (const orderId of allOrderIds) {
        await tx.shipment_order.upsert({
          where: {
            shipment_id_order_id: {
              shipment_id: primary.id,
              order_id: orderId,
            },
          },
          create: {
            shipment_id: primary.id,
            order_id: orderId,
          },
          update: {},
        });
      }

      // 2. Delete secondary shipments
      for (const s of secondaryShipments) {
        await tx.shipment_order.deleteMany({
          where: { shipment_id: s.id },
        });
        await tx.shipment.delete({
          where: { id: s.id },
        });
      }

      // 3. Update primary shipment
      const updated = await tx.shipment.update({
        where: { id: primary.id },
        data: {
          address: finalAddress,
          courier: finalCourier,
          service_type: finalServiceType,
          shipping_cost: totalShippingCost,
          notes: mergedNotes,
        },
        include: {
          customer: true,
          shipping_counter: true,
          order: {
            include: {
              items: { include: { product: true } },
              invoice_links: { include: { invoice: true } },
            },
          },
          shipment_orders: {
            include: {
              order: {
                include: {
                  items: { include: { product: true } },
                  invoice_links: { include: { invoice: true } },
                },
              },
            },
          },
        },
      });

      return updated;
    });
  }

  async split(
    id: number,
    body: { order_ids?: number[] },
    user_id?: number
  ) {
    const shipment = await this.prisma.shipment.findUniqueOrThrow({
      where: { id },
      include: {
        customer: true,
        order: {
          include: {
            items: { include: { product: true } },
            invoice_links: { include: { invoice: true } },
          },
        },
        shipment_orders: {
          include: {
            order: {
              include: {
                items: { include: { product: true } },
                invoice_links: { include: { invoice: true } },
              },
            },
          },
        },
      },
    });

    if (shipment.status !== 'WAITING_PACKING' || Boolean(shipment.packed_at)) {
      throw new BadRequestException(
        'Pemisahan pengiriman hanya dapat dilakukan untuk pengiriman yang belum dipacking (Menunggu Packing).'
      );
    }

    const ordersMap = new Map<number, any>();
    if (shipment.order) ordersMap.set(shipment.order.id, shipment.order);
    for (const so of shipment.shipment_orders || []) {
      if (so.order) ordersMap.set(so.order.id, so.order);
    }
    const allOrders = Array.from(ordersMap.values());

    if (allOrders.length <= 1) {
      throw new BadRequestException(
        'Pengiriman ini hanya memiliki 1 pesanan, tidak dapat dipisahkan per pesanan.'
      );
    }

    const requestedOrderIds = (body.order_ids || []).map(Number).filter((n) => !isNaN(n) && n > 0);
    const splitOrderIds =
      requestedOrderIds.length > 0
        ? requestedOrderIds
        : [allOrders[allOrders.length - 1].id];

    if (splitOrderIds.length >= allOrders.length) {
      throw new BadRequestException(
        'Setidaknya satu pesanan harus tetap berada dalam pengiriman awal.'
      );
    }

    const remainingOrders = allOrders.filter((o) => !splitOrderIds.includes(o.id));
    const ordersToSeparate = allOrders.filter((o) => splitOrderIds.includes(o.id));

    return await this.prisma.$transaction(async (tx) => {
      // 1. Remove separated orders from original shipment_orders
      await tx.shipment_order.deleteMany({
        where: {
          shipment_id: shipment.id,
          order_id: { in: splitOrderIds },
        },
      });

      // 2. If original shipment.order_id was split off, update primary order_id to one of the remaining
      let newPrimaryOrderId = shipment.order_id;
      if (splitOrderIds.includes(shipment.order_id)) {
        newPrimaryOrderId = remainingOrders[0].id;
      }

      const remainingItems = remainingOrders.flatMap((o) => o.items || []);
      const remainingSummary = remainingItems
        .map(
          (i) =>
            `${i.quantity}x ${i.product?.name || i.manual_product_name || 'Item'}${
              i.variation ? ` (${i.variation})` : ''
            }${i.size ? ` (${i.size})` : ''}${i.color ? ` [${i.color}]` : ''}`
        )
        .join(', ');

      const remainingCost = remainingOrders.reduce(
        (sum, o) => sum + Number(o.customer_shipping || 0),
        0
      );

      const updatedOriginal = await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          order_id: newPrimaryOrderId,
          shipping_cost: remainingCost,
          notes: remainingSummary
            ? `Item to pack: ${remainingSummary}`
            : shipment.notes,
        },
        include: {
          customer: true,
          shipping_counter: true,
          order: {
            include: {
              items: { include: { product: true } },
              invoice_links: { include: { invoice: true } },
            },
          },
          shipment_orders: {
            include: {
              order: {
                include: {
                  items: { include: { product: true } },
                  invoice_links: { include: { invoice: true } },
                },
              },
            },
          },
        },
      });

      for (const remOrd of remainingOrders) {
        await tx.shipment_order.upsert({
          where: {
            shipment_id_order_id: {
              shipment_id: shipment.id,
              order_id: remOrd.id,
            },
          },
          create: {
            shipment_id: shipment.id,
            order_id: remOrd.id,
          },
          update: {},
        });
      }

      // 3. Create new shipment(s) for the separated orders
      const createdShipments = [];
      for (const sepOrd of ordersToSeparate) {
        const sepItems = sepOrd.items || [];
        const sepSummary = sepItems
          .map(
            (i: any) =>
              `${i.quantity}x ${i.product?.name || i.manual_product_name || 'Item'}${
                i.variation ? ` (${i.variation})` : ''
              }${i.size ? ` (${i.size})` : ''}${i.color ? ` [${i.color}]` : ''}`
          )
          .join(', ');

        const newShip = await tx.shipment.create({
          data: {
            order_id: sepOrd.id,
            customer_id: shipment.customer_id,
            address: sepOrd.customer?.address?.trim() || shipment.address,
            courier: shipment.courier || 'JNE',
            service_type: shipment.service_type,
            tracking_number: null,
            shipping_cost: Number(sepOrd.customer_shipping || 0),
            status: 'WAITING_PACKING',
            notes: sepSummary
              ? `Item to pack: ${sepSummary}`
              : `Pengiriman dipisahkan untuk pesanan ${sepOrd.order_number}.`,
          },
          include: {
            customer: true,
            shipping_counter: true,
            order: {
              include: {
                items: { include: { product: true } },
                invoice_links: { include: { invoice: true } },
              },
            },
            shipment_orders: {
              include: {
                order: {
                  include: {
                    items: { include: { product: true } },
                    invoice_links: { include: { invoice: true } },
                  },
                },
              },
            },
          },
        });

        await tx.shipment_order.create({
          data: {
            shipment_id: newShip.id,
            order_id: sepOrd.id,
          },
        });

        createdShipments.push(newShip);
      }

      return {
        original_shipment: updatedOriginal,
        created_shipments: createdShipments,
      };
    });
  }

  async ensureShipmentForOrder(order_id: number) {
    return ensureShipmentForOrderHelper(this.prisma, order_id);
  }
}
