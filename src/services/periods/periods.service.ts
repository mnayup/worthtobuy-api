import { Injectable, ConflictException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

@Injectable()
export class PeriodsService implements OnModuleInit {
  constructor(private prisma: PrismaService) { }

  async onModuleInit() {
    await this.ensureReadyStockPeriod();
  }

  async ensureReadyStockPeriod() {
    const existing = await this.prisma.jastip_period.findFirst({
      where: { code: 'READY-STOCK' },
    });
    if (!existing) {
      await this.prisma.jastip_period.create({
        data: {
          code: 'READY-STOCK',
          name: 'Ready Stock',
          type: 'LOCAL',
          country: 'Indonesia',
          city: 'Warehouse',
          order_open_at: new Date('2020-01-01T00:00:00.000Z'),
          order_close_at: new Date('2099-12-31T23:59:59.000Z'),
          departure_at: new Date('2099-12-31T23:59:59.000Z'),
          return_at: new Date('2099-12-31T23:59:59.000Z'),
          estimated_shipping_at: new Date('2099-12-31T23:59:59.000Z'),
          status: 'OPEN',
          notes: 'Permanent system event for Ready Stock products.',
        },
      });
    } else if (existing.deleted_at || existing.status !== 'OPEN') {
      await this.prisma.jastip_period.update({
        where: { id: existing.id },
        data: {
          deleted_at: null,
          status: 'OPEN',
        },
      });
    }
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim().slice(0, 100);
    const status = query.status && query.status !== 'ALL' ? String(query.status) : undefined;
    const type = query.type && query.type !== 'ALL' ? String(query.type) : undefined;
    const city = query.city && query.city !== 'ALL' ? String(query.city) : undefined;

    const where: any = {
      deleted_at: null,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
      ...(search
        ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
          ],
        }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.jastip_period.findMany({
        where,
        skip,
        take: limit,
        orderBy: { departure_at: 'desc' },
      }),
      this.prisma.jastip_period.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: number) {
    return this.prisma.jastip_period.findFirstOrThrow({ where: { id, deleted_at: null } });
  }

  private cleanPeriodData(body: any) {
    const order_open_at = body.order_open_at ?? body.orderOpenAt;
    const order_close_at = body.order_close_at ?? body.orderCloseAt;
    const departure_at = body.departure_at ?? body.departureAt;
    const return_at = body.return_at ?? body.returnAt;
    const estimated_shipping_at =
      body.estimated_shipping_at ?? body.estimatedShippingAt;
    const currency_code = body.currency_code ?? body.currencyCode;
    const exchange_rate = body.exchange_rate ?? body.exchangeRate;
    const max_items = body.max_items ?? body.maxItems;
    const baggage_capacity_kg =
      body.baggage_capacity_kg ?? body.baggageCapacityKg;

    const data: any = {
      country: body.country || 'Indonesia',
    };

    if (body.code !== undefined) data.code = String(body.code).trim();
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.city !== undefined) {
      data.city = body.city ? String(body.city).trim() : null;
    }
    if (body.type !== undefined) data.type = body.type;
    if (body.status !== undefined) data.status = body.status;
    if (order_open_at !== undefined) {
      data.order_open_at = order_open_at ? new Date(order_open_at) : null;
    }
    if (order_close_at !== undefined) {
      data.order_close_at = order_close_at ? new Date(order_close_at) : null;
    }
    if (departure_at !== undefined) {
      data.departure_at = departure_at ? new Date(departure_at) : null;
    }
    if (return_at !== undefined) {
      data.return_at = return_at ? new Date(return_at) : null;
    }
    if (estimated_shipping_at !== undefined) {
      data.estimated_shipping_at = estimated_shipping_at
        ? new Date(estimated_shipping_at)
        : null;
    }
    if (currency_code !== undefined) {
      data.currency_code = String(currency_code).trim().toUpperCase();
    }
    if (exchange_rate !== undefined) {
      data.exchange_rate = Number(exchange_rate) || 1;
    }
    if (max_items !== undefined) {
      data.max_items = max_items ? Number(max_items) : null;
    }
    if (baggage_capacity_kg !== undefined) {
      data.baggage_capacity_kg = baggage_capacity_kg
        ? Number(baggage_capacity_kg)
        : null;
    }
    if (body.notes !== undefined) {
      data.notes = body.notes ? String(body.notes).trim() : null;
    }

    return data;
  }

  async create(body: any, _user_id?: number) {
    const data = this.cleanPeriodData(body);

    if (data.order_open_at && data.order_close_at) {
      if (data.order_close_at <= data.order_open_at) {
        throw new BadRequestException('Orders period end must be after orders period start.');
      }
    }
    
    if (data.departure_at && data.return_at) {
      if (data.return_at <= data.departure_at) {
        throw new BadRequestException('Event period end must be after event period start.');
      }
    }

    if (data.order_close_at && data.return_at) {
      if (data.order_close_at > data.return_at) {
        throw new BadRequestException('Orders period end cannot be after the event period end.');
      }
    }
    
    if (data.estimated_shipping_at && data.return_at) {
      if (data.estimated_shipping_at < data.return_at) {
        throw new BadRequestException(
          'Estimated shipping time cannot be before the event period end.',
        );
      }
    }

    return this.prisma.jastip_period.create({ data });
  }

  async update(id: number, body: any, user_id?: number) {
    const existing = await this.prisma.jastip_period.findUnique({ where: { id } });
    if (existing?.code === 'READY-STOCK') {
      const code = body.code;
      const status = body.status;
      if (code && code !== 'READY-STOCK') {
        throw new BadRequestException(
          'Kode event Ready Stock adalah permanen dan tidak dapat diubah.',
        );
      }
      if (status && status !== 'OPEN') {
        throw new BadRequestException('Status event Ready Stock harus selalu OPEN.');
      }
    }

    const data = this.cleanPeriodData(body);

    if (data.order_open_at && data.order_close_at) {
      if (data.order_close_at <= data.order_open_at) {
        throw new BadRequestException('Orders period end must be after orders period start.');
      }
    }
    
    if (data.departure_at && data.return_at) {
      if (data.return_at <= data.departure_at) {
        throw new BadRequestException('Event period end must be after event period start.');
      }
    }

    if (data.order_close_at && data.return_at) {
      if (data.order_close_at > data.return_at) {
        throw new BadRequestException('Orders period end cannot be after the event period end.');
      }
    }
    
    if (data.estimated_shipping_at && data.return_at) {
      if (data.estimated_shipping_at < data.return_at) {
        throw new BadRequestException(
          'Estimated shipping time cannot be before the event period end.',
        );
      }
    }

    return this.prisma.jastip_period.update({
      where: { id },
      data,
    });
  }

  async remove(id: number, user_id?: number) {
    const period = await this.prisma.jastip_period.findUnique({ where: { id } });
    if (period?.code === 'READY-STOCK') {
      throw new BadRequestException(
        'Event Ready Stock adalah event sistem permanen dan tidak dapat dihapus.',
      );
    }

    const productsCount = await this.prisma.product.count({
      where: { period_id: id, deleted_at: null, is_active: true },
    });
    if (productsCount > 0) {
      throw new ConflictException(
        'Event tidak bisa dihapus karena masih memiliki produk aktif yang terkait.',
      );
    }

    return this.prisma.jastip_period.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });
  }
}
