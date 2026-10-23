import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import {
  findPublicTargetOrder,
  buildTrackingTimelineResponse,
} from './helpers/public-tracking.helper';
import {
  fetchPublicInvoiceData,
  createPublicPaymentProof,
  updatePublicShippingMethod,
} from './helpers/public-invoice.helper';
import { PUBLIC_FAQ_ITEMS } from './helpers/public-content.helper';
import { fetchPublicOverviewData } from './helpers/public-overview.helper';
import {
  fetchPublicCatalogProducts,
  fetchPublicCatalogProductDetail,
} from './helpers/public-catalog.helper';

@Injectable()
export class PublicService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    return fetchPublicOverviewData(this.prisma);
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
    return fetchPublicCatalogProducts(this.prisma, query);
  }

  async getProductDetail(id: number) {
    return fetchPublicCatalogProductDetail(this.prisma, id);
  }

  async trackOrder(identifier: string) {
    if (!identifier || identifier.trim().length < 3) {
      throw new NotFoundException(
        'Nomor resi, invoice, atau order ID tidak valid.'
      );
    }
    const clean = identifier.trim();
    const { targetOrder, invoice } = await findPublicTargetOrder(
      this.prisma,
      clean
    );
    return buildTrackingTimelineResponse(targetOrder, invoice);
  }

  async getPublicInvoice(invoiceNumber: string) {
    return fetchPublicInvoiceData(this.prisma, invoiceNumber);
  }

  async submitPublicPaymentProof(invoiceNumber: string, body: any) {
    return createPublicPaymentProof(this.prisma, invoiceNumber, body);
  }

  async updatePublicShippingMethod(invoiceNumber: string, body: any) {
    return updatePublicShippingMethod(this.prisma, invoiceNumber, body);
  }
}
