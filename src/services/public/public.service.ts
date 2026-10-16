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

    const [categoriesRaw, rawSettings, brandRecord, invoiceRecord] = await Promise.all([
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
      this.prisma.setting.findMany(),
      this.prisma.brand_setting.findFirst({ orderBy: { id: 'desc' } }),
      this.prisma.invoice_setting.findFirst({ orderBy: { id: 'desc' } }),
    ]);

    const settingsMap = Object.fromEntries(rawSettings.map((x) => [x.key, x.value]));
    const fallbackBrandVal = (settingsMap['brand'] as any) || {};
    const fallbackInvoiceVal = (settingsMap['invoice'] as any) || {};

    const brandName =
      brandRecord?.name || fallbackBrandVal.name || process.env.BRAND_NAME || 'WORTHTOBUY';
    const brandTagline =
      brandRecord?.tagline ||
      fallbackBrandVal.tagline ||
      process.env.BRAND_TAGLINE ||
      'Your Trusted Jastip Bestie & Personal Shopper Nasional';
    const brandWhatsapp =
      brandRecord?.whatsapp ||
      fallbackBrandVal.whatsapp ||
      invoiceRecord?.whatsapp ||
      fallbackInvoiceVal.whatsapp ||
      process.env.BRAND_WHATSAPP ||
      '6285186852535';
    const brandInstagram =
      brandRecord?.instagram ||
      fallbackBrandVal.instagram ||
      process.env.BRAND_INSTAGRAM ||
      '@worthtobuy_sub';
    const brandInstagramUrl =
      brandRecord?.instagram_url ||
      fallbackBrandVal.instagramUrl ||
      process.env.BRAND_INSTAGRAM_URL ||
      'https://www.instagram.com/worthtobuy_sub';
    const brandPrimaryColor =
      brandRecord?.primary_color || fallbackBrandVal.primaryColor || '#b7332b';
    const brandLogoUrl =
      brandRecord?.logo_url || fallbackBrandVal.logoUrl || '/worthtobuy-logo.png';

    const bankName =
      invoiceRecord?.bank_name ||
      fallbackInvoiceVal.bankName ||
      process.env.DEFAULT_BANK_NAME ||
      'BCA (Bank Central Asia)';
    const bankAccount =
      invoiceRecord?.account_number ||
      fallbackInvoiceVal.accountNumber ||
      process.env.DEFAULT_BANK_ACCOUNT ||
      '1234567890';
    const bankHolder =
      invoiceRecord?.account_holder ||
      fallbackInvoiceVal.accountHolder ||
      process.env.DEFAULT_BANK_HOLDER ||
      'WORTHTOBUY';

    const categories = categoriesRaw.map((c) => c.category).filter(Boolean);

    return {
      brand: {
        name: brandName,
        tagline: brandTagline,
        instagram: brandInstagram,
        instagramUrl: brandInstagramUrl,
        whatsapp: brandWhatsapp,
        city: process.env.BRAND_CITY || 'Indonesia',
        primaryColor: brandPrimaryColor,
        logoUrl: brandLogoUrl,
        bank: {
          bankName,
          accountNumber: bankAccount,
          accountHolder: bankHolder,
        },
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

    const normalizedItems = items.map((p) => {
      const rawImgs = p.image_urls || [];
      const primaryImg =
        p.image_url ||
        (Array.isArray(rawImgs) && rawImgs.length > 0 ? rawImgs[0] : null);
      return {
        ...p,
        imageUrl: primaryImg,
        imageUrls: rawImgs,
        brandName: p.brand_name,
        sellingPrice: Number(p.selling_price),
        buyPrice: Number(p.buy_price),
        stockQuantity: p.stock_quantity,
        stockMode: p.stock_mode,
      };
    });

    return {
      items: normalizedItems,
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
    const p = await this.prisma.product.findFirstOrThrow({
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

    const rawImgs = p.image_urls || [];
    const primaryImg =
      p.image_url ||
      (Array.isArray(rawImgs) && rawImgs.length > 0 ? rawImgs[0] : null);

    return {
      ...p,
      imageUrl: primaryImg,
      imageUrls: rawImgs,
      brandName: p.brand_name,
      sellingPrice: Number(p.selling_price),
      buyPrice: Number(p.buy_price),
      stockQuantity: p.stock_quantity,
      stockMode: p.stock_mode,
    };
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
