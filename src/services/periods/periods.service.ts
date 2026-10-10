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
      this.prisma.jastip_period.findMany({ where, skip, take: limit, orderBy: { departure_at: 'desc' } }),
      this.prisma.jastip_period.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: number) {
    return this.prisma.jastip_period.findFirstOrThrow({ where: { id, deleted_at: null } });
  }

  async create(body: any, user_id?: number) {

    if (body.order_open_at && body.order_close_at) {
      const open = new Date(body.order_open_at);
      const close = new Date(body.order_close_at);
      if (close <= open) {
        throw new BadRequestException('Orders period end must be after orders period start.');
      }
    }
    
    if (body.departure_at && body.return_at) {
      const dep = new Date(body.departure_at);
      const ret = new Date(body.return_at);
      if (ret <= dep) {
        throw new BadRequestException('Event period end must be after event period start.');
      }
    }

    if (body.order_close_at && body.return_at) {
      const close = new Date(body.order_close_at);
      const ret = new Date(body.return_at);
      if (close > ret) {
        throw new BadRequestException('Orders period end cannot be after the event period end.');
      }
    }
    
    if (body.estimated_shipping_at && body.return_at) {
      const ship = new Date(body.estimated_shipping_at);
      const ret = new Date(body.return_at);
      if (ship < ret) {
        throw new BadRequestException('Estimated shipping time cannot be before the event period end.');
      }
    }

    return this.prisma.jastip_period.create({
      data: {
        ...body,
        country: 'Indonesia',
        currency_code: 'IDR',
        exchange_rate: 1,
      },
    });
  }

  async update(id: number, body: any, user_id?: number) {
    const existing = await this.prisma.jastip_period.findUnique({ where: { id } });
    if (existing?.code === 'READY-STOCK') {
      if (body.code && body.code !== 'READY-STOCK') {
        throw new BadRequestException('Kode event Ready Stock adalah permanen dan tidak dapat diubah.');
      }
      if (body.status && body.status !== 'OPEN') {
        throw new BadRequestException('Status event Ready Stock harus selalu OPEN.');
      }
    }

    if (body.order_open_at && body.order_close_at) {
      const open = new Date(body.order_open_at);
      const close = new Date(body.order_close_at);
      if (close <= open) {
        throw new BadRequestException('Orders period end must be after orders period start.');
      }
    }
    
    if (body.departure_at && body.return_at) {
      const dep = new Date(body.departure_at);
      const ret = new Date(body.return_at);
      if (ret <= dep) {
        throw new BadRequestException('Event period end must be after event period start.');
      }
    }

    if (body.order_close_at && body.return_at) {
      const close = new Date(body.order_close_at);
      const ret = new Date(body.return_at);
      if (close > ret) {
        throw new BadRequestException('Orders period end cannot be after the event period end.');
      }
    }
    
    if (body.estimated_shipping_at && body.return_at) {
      const ship = new Date(body.estimated_shipping_at);
      const ret = new Date(body.return_at);
      if (ship < ret) {
        throw new BadRequestException('Estimated shipping time cannot be before the event period end.');
      }
    }

    return this.prisma.jastip_period.update({
      where: { id },
      data: {
        ...body,
        country: 'Indonesia',
        currency_code: 'IDR',
        exchange_rate: 1,
      },
    });
  }

  async remove(id: number, user_id?: number) {
    const period = await this.prisma.jastip_period.findUnique({ where: { id } });
    if (period?.code === 'READY-STOCK') {
      throw new BadRequestException('Event Ready Stock adalah event sistem permanen dan tidak dapat dihapus.');
    }

    const productsCount = await this.prisma.product.count({
      where: { period_id: id, deleted_at: null, is_active: true },
    });
    if (productsCount > 0) {
      throw new ConflictException('Event tidak bisa dihapus karena masih memiliki produk aktif yang terkait.');
    }

    return this.prisma.jastip_period.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });
  }
}
