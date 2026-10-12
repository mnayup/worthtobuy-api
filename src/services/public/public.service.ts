import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import {
  findPublicTargetOrder,
  buildTrackingTimelineResponse,
} from './helpers/public-tracking.helper';
import {
  fetchPublicInvoiceData,
  createPublicPaymentProof,
} from './helpers/public-invoice.helper';
import { PUBLIC_HIGHLIGHTS, PUBLIC_FAQ_ITEMS } from './helpers/public-content.helper';

@Injectable()
export class PublicService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const [totalEvents, totalProducts, readyStockCount, openEvents] = await Promise.all([
      this.prisma.jastip_period.count({ where: { deleted_at: null } }),
      this.prisma.product.count({ where: { deleted_at: null, is_active: true } }),
      this.prisma.product.count({
        where: {
          deleted_at: null,
          is_active: true,
          stock_mode: { in: ['READY_STOCK', 'BOTH'] },
        },
      }),
      this.prisma.jastip_period.count({
        where: {
          deleted_at: null,
          status: { in: ['OPEN', 'SHOPPING'] },
        },
      }),
    ]);

    const categoriesRaw = await this.prisma.product.findMany({
      where: {
        deleted_at: null,
        is_active: true,
        stock_mode: { in: ['READY_STOCK', 'BOTH'] },
        category: { not: null },
      },
      select: { category: true },
      distinct: ['category'],
    });

    const categories = categoriesRaw.map((c) => c.category).filter(Boolean);

    return {
      brand: {
        name: 'WORTHTOBUY',
        tagline: 'Your Trusted Jastip Bestie & Personal Shopper Nasional',
        instagram: '@worthtobuy_id',
        instagramUrl: 'https://www.instagram.com/worthtobuy_id',
        whatsapp: '+6281234567890',
        city: 'Indonesia',
        establishedYear: 2019,
        stats: {
          followers: '3,200+',
          eventsCompleted: Math.max(150, totalEvents + 145),
          totalProductsAvailable: totalProducts,
          readyStockItems: readyStockCount,
          activeEvents: openEvents,
          rating: '4.9/5.0',
        },
      },
      categories,
      highlights: PUBLIC_HIGHLIGHTS,
    };
  }

  async getFaq() {
    return PUBLIC_FAQ_ITEMS;
  }

  async getEvents(query: any) {
    const status = query.status ? String(query.status) : undefined;
    const where: any = {
      deleted_at: null,
      code: { not: 'READY-STOCK' },
      ...(status ? { status } : {}),
    };

    const events = await this.prisma.jastip_period.findMany({
      where,
      orderBy: { departure_at: 'desc' },
      include: {
        _count: {
          select: {
            orders: { where: { deleted_at: null } },
            products: { where: { deleted_at: null, is_active: true } },
          },
        },
      },
    });

    return events.map((ev) => ({
      id: ev.id,
      code: ev.code,
      name: ev.name,
      description: ev.notes || ev.name,
      city: ev.city,
      country: ev.country,
      status: ev.status,
      bannerUrl: null,
      departure_at: ev.departure_at,
      return_at: ev.return_at,
      order_close_at: ev.order_close_at,
      estimated_shipping_at: ev.estimated_shipping_at,
      productCount: ev._count.products,
      orderCount: ev._count.orders,
    }));
  }

  async getEventDetail(id: number) {
    return this.prisma.jastip_period.findFirstOrThrow({
      where: {
        id,
        deleted_at: null,
        code: { not: 'READY-STOCK' },
      },
      include: {
        products: {
          where: { deleted_at: null, is_active: true },
          orderBy: { created_at: 'desc' },
        },
      },
    });
  }

  async getProducts(query: any) {
    return this.getReadyStock(query);
  }

  async getReadyStock(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 24)));
    const skip = (page - 1) * limit;

    const search = String(query.search || '').trim();
    const category = query.category ? String(query.category) : undefined;
    const brand = query.brand ? String(query.brand) : undefined;
    const stock_mode = query.stock_mode ? String(query.stock_mode) : undefined;
    const period_id = query.period_id ? Number(query.period_id) : undefined;

    const where: any = {
      deleted_at: null,
      is_active: true,
      ...(stock_mode ? { stock_mode } : { stock_mode: { in: ['READY_STOCK', 'BOTH'] } }),
      ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
      ...(brand ? { brand_name: { equals: brand, mode: 'insensitive' } } : {}),
      ...(period_id ? { period_id } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { brand_name: { contains: search, mode: 'insensitive' } },
              { category: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total, categoriesRaw, brandsRaw] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ stock_quantity: 'desc' }, { created_at: 'desc' }],
        include: {
          period: {
            select: {
              id: true,
              name: true,
              city: true,
              country: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where: {
          deleted_at: null,
          is_active: true,
          stock_mode: { in: ['READY_STOCK', 'BOTH'] },
          category: { not: null },
        },
        select: { category: true },
        distinct: ['category'],
      }),
      this.prisma.product.findMany({
        where: {
          deleted_at: null,
          is_active: true,
          stock_mode: { in: ['READY_STOCK', 'BOTH'] },
          brand_name: { not: null },
        },
        select: { brand_name: true },
        distinct: ['brand_name'],
      }),
    ]);

    const categories = categoriesRaw.map((c) => c.category).filter(Boolean);
    const brands = brandsRaw.map((b) => b.brand_name).filter(Boolean);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      filters: {
        categories,
        brands,
      },
    };
  }

  async getProductDetail(id: number) {
    return this.prisma.product.findFirstOrThrow({
      where: {
        id,
        deleted_at: null,
        is_active: true,
      },
      include: {
        period: {
          select: {
            id: true,
            name: true,
            city: true,
            country: true,
            status: true,
          },
        },
      },
    });
  }

  async trackOrder(identifier: string) {
    if (!identifier || identifier.trim().length < 3) {
      throw new NotFoundException('Nomor resi, invoice, atau order ID tidak valid.');
    }
    const clean = identifier.trim();
    const { targetOrder, invoice } = await findPublicTargetOrder(this.prisma, clean);
    return buildTrackingTimelineResponse(targetOrder, invoice);
  }

  async getPublicInvoice(invoiceNumber: string) {
    return fetchPublicInvoiceData(this.prisma, invoiceNumber);
  }

  async submitPublicPaymentProof(invoiceNumber: string, body: any) {
    return createPublicPaymentProof(this.prisma, invoiceNumber, body);
  }
}
