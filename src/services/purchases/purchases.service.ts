import { Injectable } from "@nestjs/common";
import { PrismaService } from '../../config/prisma/prisma.service';
import { RefundService } from '../shared/refund.service';
import { sequence } from '../../common/utils/http.utils';

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private refundService: RefundService,
  ) { }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const search = String(query.search || "").trim().slice(0, 100);
    const status = query.status ? String(query.status) : undefined;

    const where: any = {
      order_item: { order: { deleted_at: null } },
      ...(status ? { status } : {}),
      ...(search
        ? {
          OR: [
            { purchase_number: { contains: search, mode: "insensitive" } },
            { brand_name: { contains: search, mode: "insensitive" } },
            { product: { name: { contains: search, mode: "insensitive" } } },
            { product: { sku: { contains: search, mode: "insensitive" } } },
            { shopper: { name: { contains: search, mode: "insensitive" } } },
            { period: { code: { contains: search, mode: "insensitive" } } },
            { period: { name: { contains: search, mode: "insensitive" } } },
            { payment_method: { contains: search, mode: "insensitive" } },
            { notes: { contains: search, mode: "insensitive" } },
            { order_item: { manual_product_name: { contains: search, mode: "insensitive" } } },
            { order_item: { order: { order_number: { contains: search, mode: "insensitive" } } } },
            { order_item: { order: { customer: { full_name: { contains: search, mode: "insensitive" } } } } },
            { order_item: { order: { customer: { whatsapp: { contains: search } } } } },
          ],
        }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { purchase_date: "desc" },
        include: {
          product: true,
          period: true,
          shopper: { select: { name: true } },
          order_item: { include: { product: true, order: { include: { customer: true } } } },
        },
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  
  async getSummary() {
    const purchases = await this.prisma.purchase.findMany({
      select: { status: true },
    });
    
    const summary = {
      TOTAL: purchases.length,
      WAITING_PURCHASE: 0,
      PURCHASED: 0,
      UNAVAILABLE: 0,
    };
    
    purchases.forEach((p) => {
      if (summary[p.status] !== undefined) {
        summary[p.status]++;
      }
    });
    
    return summary;
  }

  async create(body: any, user_id?: number) {
    const item = await this.prisma.order_item.findUniqueOrThrow({
      where: { id: body.order_item_id },
      include: { order: { include: { customer: true } } },
    });
    const status = body.status || "WAITING_PURCHASE";
    const estimated = Number(body.estimated_price ?? 0);
    const actual = Number(body.actual_price ?? estimated);

    const data = await this.prisma.purchase.create({
      data: {
        ...body,
        status,
        product_id: body.product_id || item.product_id || null,
        purchase_number: body.purchase_number || sequence("PUR"),
        shopper_id: body.shopper_id || user_id,
        estimated_price: estimated,
        actual_price: actual,
        price_difference: actual - estimated,
        currency_code: "IDR",
        exchange_rate: 1,
      },
      include: { order_item: { include: { order: { include: { customer: true } } } } },
    });

    if (status === "PURCHASED") {
      await this.handlePurchasedTransition(data.order_item.order, item.id, item.fulfillment_status, user_id);
    } else if (status === "UNAVAILABLE") {
      await this.handleUnavailableTransition(data.order_item.order, item.id, item.fulfillment_status, user_id);
    } else {
      await this.prisma.order_item.update({
        where: { id: item.id },
        data: { purchase_status: "WAITING_PURCHASE", fulfillment_status: "PENDING", status_updated_at: new Date() },
      });
    }

    return data;
  }

  async update(id: number, body: any, user_id?: number) {
    const current = await this.prisma.purchase.findUniqueOrThrow({
      where: { id },
      include: {
        order_item: {
          include: {
            order: {
              include: { customer: true },
            },
          },
        },
      },
    });

    const estimated = Number(body.estimated_price ?? current.estimated_price);
    const actual = Number(body.actual_price ?? current.actual_price);
    const price_difference = actual - estimated;

    const data = await this.prisma.purchase.update({
      where: { id: current.id },
      data: {
        ...body,
        product_id: body.product_id === undefined ? undefined : body.product_id || null,
        price_difference,
        currency_code: "IDR",
        exchange_rate: 1,
      },
      include: {
        order_item: {
          include: {
            order: {
              include: { customer: true },
            },
          },
        },
      },
    });

    const targetStatus = body.status;
    if (targetStatus && targetStatus !== current.status) {
      const order = current.order_item.order;
      const order_item_id = current.order_item_id;
      const from_status = current.order_item.fulfillment_status;

      if (targetStatus === "PURCHASED") {
        await this.handlePurchasedTransition(order, order_item_id, from_status, user_id);
      } else if (targetStatus === "UNAVAILABLE") {
        await this.handleUnavailableTransition(order, order_item_id, from_status, user_id);
      } else if (targetStatus === "WAITING_PURCHASE") {
        await this.prisma.order_item.update({
          where: { id: order_item_id },
          data: {
            purchase_status: "WAITING_PURCHASE",
            fulfillment_status: "PENDING",
            status_updated_at: new Date(),
          },
        });
        if (["WAITING_SETTLEMENT", "READY_TO_SHIP"].includes(order.status)) {
          await this.prisma.order.update({
            where: { id: order.id },
            data: { status: "WAITING_PURCHASE" },
          });
        }
      }
    }

    return data;
  }

  private async handlePurchasedTransition(order: any, order_item_id: number, from_status: any, user_id?: number) {
    await this.prisma.order_item.update({
      where: { id: order_item_id },
      data: { purchase_status: "PURCHASED", fulfillment_status: "AVAILABLE", status_updated_at: new Date() },
    });

    await this.prisma.item_status_history.create({
      data: {
        order_item_id,
        from_status,
        to_status: "AVAILABLE",
        notes: "Status pembelian diubah menjadi Sudah Dibeli (PURCHASED).",
        user_id,
      },
    });

    const pendingItems = await this.prisma.order_item.count({
      where: {
        order_id: order.id,
        fulfillment_status: {
          notIn: ["AVAILABLE", "KEPT", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "UNAVAILABLE"],
        },
      },
    });

    if (pendingItems === 0) {
      const freshOrder = await this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { customer: true, shipments: true },
      });

      const isPartial = Number(freshOrder.outstanding_amount) > 0;
      if (isPartial) {
        await this.prisma.order.update({
          where: { id: freshOrder.id },
          data: { status: "WAITING_SETTLEMENT" },
        });
      } else {
        await this.prisma.order.update({
          where: { id: freshOrder.id },
          data: { status: "READY_TO_SHIP" },
        });
      }

      // Auto create shipment on pengiriman (both for partial or full payment when items are available)
      if (!freshOrder.shipments || freshOrder.shipments.length === 0) {
        const orderWithItems = await this.prisma.order.findUnique({
          where: { id: freshOrder.id },
          include: { items: { include: { product: true } } },
        });
        const itemsSummary = orderWithItems?.items && orderWithItems.items.length > 0
          ? orderWithItems.items.map(i => `${i.quantity}x ${i.product?.name || i.manual_product_name || 'Item'}${i.variation ? ` (${i.variation})` : ''}${i.size ? ` (${i.size})` : ''}${i.color ? ` [${i.color}]` : ''}`).join(', ')
          : '';
        const address = freshOrder.customer?.address && freshOrder.customer?.address.trim() !== "-"
          ? freshOrder.customer.address.trim()
          : "-";
        await this.prisma.shipment.create({
          data: {
            order_id: freshOrder.id,
            customer_id: freshOrder.customer_id,
            address: address,
            courier: "JNE",
            service_type: null,
            tracking_number: null,
            shipping_cost: freshOrder.customer_shipping || 0,
            status: "WAITING_PACKING",
            notes: itemsSummary ? `Item to pack: ${itemsSummary}` : "Pengiriman otomatis dibuat setelah barang pesanan " + freshOrder.order_number + " tersedia.",
          },
        });
      }
    }
  }

  private async handleUnavailableTransition(order: any, order_item_id: number, from_status: any, user_id?: number) {
    await this.prisma.order_item.update({
      where: { id: order_item_id },
      data: { purchase_status: "UNAVAILABLE", fulfillment_status: "UNAVAILABLE", status_updated_at: new Date() },
    });

    await this.prisma.item_status_history.create({
      data: {
        order_item_id,
        from_status,
        to_status: "UNAVAILABLE",
        notes: "Status pembelian diubah menjadi Tidak Tersedia (UNAVAILABLE).",
        user_id,
      },
    });

    await this.refundService.ensureUnavailableItemRefund(order_item_id);

    const totalItems = await this.prisma.order_item.count({ where: { order_id: order.id } });
    const unavailableCount = await this.prisma.order_item.count({
      where: { order_id: order.id, fulfillment_status: "UNAVAILABLE" },
    });

    if (totalItems > 0 && totalItems === unavailableCount) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: "UNAVAILABLE" },
      });
    }
  }
}
