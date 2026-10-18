import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { RefundService } from '../shared/refund.service';
import { sequence } from '../../common/utils/http.utils';
import {
  handlePurchasedTransitionHelper,
  handleUnavailableTransitionHelper,
} from './helpers/purchase-transitions.helper';
import {
  formatConsolidatedPurchase,
  groupPurchasesByNumber,
} from './helpers/purchase-consolidation.helper';
import {
  cleanPurchaseData,
  updateConsolidatedPurchaseHelper,
} from './helpers/purchase-update.helper';

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private refundService: RefundService,
  ) {}

  async findAll(query: any) {
    const search = String(query.search || '').trim().slice(0, 100);
    const status = query.status ? String(query.status) : undefined;
    const periodId = query.periodId || query.period_id;
    const brand = query.brand || query.brandName || query.brand_name;

    const where: any = {
      order_item: { order: { deleted_at: null } },
      ...(status ? { status } : {}),
      ...(periodId ? { period_id: Number(periodId) } : {}),
      ...(brand
        ? {
            OR: [
              { brand_name: { equals: String(brand).trim(), mode: 'insensitive' } },
              { product: { brand_name: { equals: String(brand).trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(search
        ? {
            OR: [
              { purchase_number: { contains: search, mode: 'insensitive' } },
              { brand_name: { contains: search, mode: 'insensitive' } },
              { product: { name: { contains: search, mode: 'insensitive' } } },
              { product: { sku: { contains: search, mode: 'insensitive' } } },
              { shopper: { name: { contains: search, mode: 'insensitive' } } },
              { period: { code: { contains: search, mode: 'insensitive' } } },
              { period: { name: { contains: search, mode: 'insensitive' } } },
              { payment_method: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              {
                order_item: {
                  manual_product_name: { contains: search, mode: 'insensitive' },
                },
              },
              {
                order_item: {
                  order: { order_number: { contains: search, mode: 'insensitive' } },
                },
              },
              {
                order_item: {
                  order: {
                    customer: { full_name: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const rawPurchases = await this.prisma.purchase.findMany({
      where,
      orderBy: [{ purchase_date: 'desc' }, { id: 'desc' }],
      include: {
        product: true,
        period: true,
        shopper: { select: { name: true } },
        order_item: {
          include: {
            product: true,
            order: { include: { customer: true } },
          },
        },
      },
    });

    const consolidated = groupPurchasesByNumber(rawPurchases);
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const paginated = consolidated.slice(skip, skip + limit);

    return {
      data: paginated,
      total: consolidated.length,
      page,
      limit,
    };
  }

  async findOne(id: number) {
    const target = await this.prisma.purchase.findUniqueOrThrow({ where: { id } });
    const where: any =
      target.status === 'WAITING_PURCHASE' && target.period_id
        ? {
            OR: [
              { purchase_number: target.purchase_number },
              { period_id: target.period_id, status: 'WAITING_PURCHASE' },
            ],
          }
        : { purchase_number: target.purchase_number };

    const allRows = await this.prisma.purchase.findMany({
      where,
      include: {
        product: true,
        period: true,
        shopper: { select: { name: true } },
        order_item: {
          include: {
            product: true,
            order: { include: { customer: true } },
          },
        },
      },
    });
    return formatConsolidatedPurchase(allRows);
  }

  async getSummary() {
    const raw = await this.prisma.purchase.findMany({
      where: {
        order_item: { order: { deleted_at: null } },
      },
      select: { purchase_number: true, status: true, period_id: true },
    });
    const map = new Map<string, string[]>();
    raw.forEach((r) => {
      const key =
        r.status === 'WAITING_PURCHASE' && r.period_id
          ? `EVENT_${r.period_id}_WAITING`
          : r.purchase_number;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r.status);
    });

    const summary = {
      TOTAL: map.size,
      WAITING_PURCHASE: 0,
      PURCHASED: 0,
      UNAVAILABLE: 0,
    };

    for (const statuses of map.values()) {
      if (statuses.every((s) => s === 'PURCHASED')) summary.PURCHASED++;
      else if (statuses.every((s) => s === 'UNAVAILABLE')) summary.UNAVAILABLE++;
      else summary.WAITING_PURCHASE++;
    }

    return summary;
  }

  async create(body: any, userId?: number) {
    const oItemId = body.order_item_id ?? body.orderItemId;
    const item = await this.prisma.order_item.findUniqueOrThrow({
      where: { id: Number(oItemId) },
      include: {
        product: true,
        order: { include: { customer: true } },
      },
    });
    const cleaned = cleanPurchaseData(body);
    const status = cleaned.status || 'WAITING_PURCHASE';
    const buyPrice = Number(item.product?.buy_price || 0);
    const unitCost = buyPrice > 0
      ? buyPrice
      : Number(item.target_price_idr ?? item.unit_price_foreign ?? 0);
    const qty = Number(cleaned.quantity || item.quantity || 1);
    const defaultCost = unitCost * qty;
    const estimated = Number(cleaned.estimated_price ?? defaultCost);
    const actual = Number(cleaned.actual_price ?? estimated);

    const data = await this.prisma.purchase.create({
      data: {
        ...cleaned,
        order_item_id: item.id,
        period_id: cleaned.period_id || item.order.period_id,
        brand_name: cleaned.brand_name || item.brand_name || '-',
        quantity: cleaned.quantity || item.quantity || 1,
        status,
        product_id: cleaned.product_id !== undefined ? cleaned.product_id : item.product_id || null,
        purchase_number: cleaned.purchase_number || sequence('PUR'),
        shopper_id: cleaned.shopper_id || userId,
        estimated_price: estimated,
        actual_price: actual,
        price_difference: actual - estimated,
        currency_code: 'IDR',
        exchange_rate: 1,
      },
      include: {
        order_item: { include: { order: { include: { customer: true } } } },
      },
    });

    if (status === 'PURCHASED') {
      await handlePurchasedTransitionHelper(
        this.prisma,
        data.order_item.order,
        item.id,
        item.fulfillment_status,
        userId
      );
    } else if (status === 'UNAVAILABLE') {
      await handleUnavailableTransitionHelper(
        this.prisma,
        this.refundService,
        data.order_item.order,
        item.id,
        item.fulfillment_status,
        userId
      );
    }

    return data;
  }

  async update(id: number, body: any, userId?: number) {
    const current = await this.prisma.purchase.findUniqueOrThrow({
      where: { id },
      include: {
        order_item: {
          include: { order: { include: { customer: true } } },
        },
      },
    });

    // Check if updating via consolidated items checklist
    if (Array.isArray(body.items) && body.items.length > 0) {
      const targetId = await updateConsolidatedPurchaseHelper(
        this.prisma,
        this.refundService,
        current.purchase_number,
        body,
        userId
      );
      return this.findOne(targetId || current.id);
    }

    const cleaned = cleanPurchaseData(body);
    const estimated = Number(cleaned.estimated_price ?? current.estimated_price);
    const actual = Number(cleaned.actual_price ?? current.actual_price);
    const price_difference = actual - estimated;

    const data = await this.prisma.purchase.update({
      where: { id: current.id },
      data: {
        ...cleaned,
        product_id: cleaned.product_id === undefined ? undefined : cleaned.product_id || null,
        estimated_price: estimated,
        actual_price: actual,
        price_difference,
        currency_code: 'IDR',
        exchange_rate: 1,
      },
      include: {
        order_item: {
          include: { order: { include: { customer: true } } },
        },
      },
    });

    const targetStatus = body.status;
    if (targetStatus && targetStatus !== current.status) {
      const order = current.order_item.order;
      const order_item_id = current.order_item_id;
      const from_status = current.order_item.fulfillment_status;

      if (targetStatus === 'PURCHASED') {
        await handlePurchasedTransitionHelper(
          this.prisma,
          order,
          order_item_id,
          from_status,
          userId
        );
      } else if (targetStatus === 'UNAVAILABLE') {
        await handleUnavailableTransitionHelper(
          this.prisma,
          this.refundService,
          order,
          order_item_id,
          from_status,
          userId
        );
      }
    }

    return data;
  }
}
