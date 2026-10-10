import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { StockService } from '../shared/stock.service';
import { sequence } from '../../common/utils/http.utils';

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
  ) { }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim().slice(0, 100);
    const stock_mode = query.stock_mode ? String(query.stock_mode) : undefined;
    const period_id = query.period_id ? Number(query.period_id) : query.eventId ? Number(query.eventId) : undefined;
    const lowStock = String(query.lowStock || '') === '1';
    const category = query.category && query.category !== 'ALL' ? String(query.category) : undefined;
    const brand_name = query.brand_name && query.brand_name !== 'ALL' ? String(query.brand_name) : undefined;
    const activePeriod = String(query.activePeriod || '') === 'true';

    let periodFilter = {};
    if (period_id) {
      const period = await this.prisma.jastip_period.findUnique({ where: { id: period_id } });
      if (period?.code === 'READY-STOCK') {
        periodFilter = { stock_mode: { in: ['READY_STOCK', 'BOTH'] } };
      } else {
        periodFilter = { period_id };
      }
    } else if (activePeriod) {
      periodFilter = {
        OR: [
          { stock_mode: { in: ['READY_STOCK', 'BOTH'] } },
          { period: { status: 'OPEN' } }
        ]
      };
    }

    const where: any = {
      deleted_at: null,
      ...(stock_mode ? { stock_mode } : {}),
      ...(category ? { category: { contains: category, mode: 'insensitive' } } : {}),
      ...(brand_name ? { brand_name: { contains: brand_name, mode: 'insensitive' } } : {}),
      ...periodFilter,
      ...(search
        ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            { brand_name: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } },
            { store_location: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
          ],
        }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({ where, skip, take: limit, orderBy: { created_at: 'desc' } }),
      this.prisma.product.count({ where }),
    ]);

    const data = lowStock
      ? rows.filter(
        row => ['READY_STOCK', 'BOTH'].includes(row.stock_mode) && row.stock_quantity - row.reserved_quantity <= row.low_stock_threshold,
      )
      : rows;

    return { data, total: lowStock ? data.length : total, page, limit };
  }

  async findMovements(product_id: number) {
    return this.prisma.inventory_movement.findMany({
      where: { product_id },
      orderBy: { created_at: 'desc' },
      take: 100,
      include: { user: { select: { name: true } } },
    });
  }

  async create(body: any, user_id?: number) {
    if (body.sku) {
      const duplicate = await this.prisma.product.findFirst({ where: { sku: { equals: body.sku, mode: 'insensitive' } } });
      if (duplicate) throw new ConflictException(`SKU ${body.sku} sudah digunakan oleh ${duplicate.name}.`);
    }

    const {
      periodId_option,
      stockMode_option,
      ...raw
    } = body;

    const data: any = {
      sku: raw.sku ? String(raw.sku).trim() : sequence('SKU'),
      name: String(raw.name || '').trim(),
      category: raw.category ? String(raw.category).trim() : null,
      brand_name: raw.brand_name ? String(raw.brand_name).trim() : null,
      store_location: raw.store_location ? String(raw.store_location).trim() : null,
      product_url: raw.product_url ? String(raw.product_url).trim() : null,
      image_url: raw.image_url ? String(raw.image_url).trim() : null,
      default_currency: 'IDR',
      stock_mode: raw.stock_mode || 'EVENT',
      stock_quantity: Number(raw.stock_quantity || 0),
      buy_price: Number(raw.buy_price || 0),
      selling_price: Number(raw.selling_price || 0),
      low_stock_threshold: Number(raw.low_stock_threshold || 0),
      notes: raw.notes ? String(raw.notes).trim() : null,
      period_id: raw.period_id ? Number(raw.period_id) : null,
      is_active: raw.is_active !== undefined ? Boolean(raw.is_active) : true,
    };

    return this.prisma.$transaction(async tx => {
      const product = await tx.product.create({ data });

      if (data.stock_quantity > 0) {
        await tx.inventory_movement.create({
          data: {
            product_id: product.id,
            movement_type: 'INITIAL',
            quantity: data.stock_quantity,
            balance_after: data.stock_quantity,
            reference_type: 'PRODUCT',
            reference_id: String(product.id),
            notes: 'Stok awal produk.',
            user_id,
          },
        });
      }
      return product;
    });
  }

  async update(id: number, body: any, user_id?: number) {
    if (body.sku) {
      const duplicate = await this.prisma.product.findFirst({
        where: { id: { not: id }, sku: { equals: body.sku, mode: 'insensitive' } },
      });
      if (duplicate) throw new ConflictException(`SKU ${body.sku} sudah digunakan oleh ${duplicate.name}.`);
    }

    const {
      stock_quantity,
      periodId_option,
      stockMode_option,
      ...raw
    } = body;

    const data: any = {
      default_currency: 'IDR',
      ...(raw.sku !== undefined ? { sku: String(raw.sku).trim() } : {}),
      ...(raw.name !== undefined ? { name: String(raw.name).trim() } : {}),
      ...(raw.category !== undefined ? { category: raw.category ? String(raw.category).trim() : null } : {}),
      ...(raw.brand_name !== undefined ? { brand_name: raw.brand_name ? String(raw.brand_name).trim() : null } : {}),
      ...(raw.store_location !== undefined ? { store_location: raw.store_location ? String(raw.store_location).trim() : null } : {}),
      ...(raw.product_url !== undefined ? { product_url: raw.product_url ? String(raw.product_url).trim() : null } : {}),
      ...(raw.image_url !== undefined ? { image_url: raw.image_url ? String(raw.image_url).trim() : null } : {}),
      ...(raw.stock_mode !== undefined ? { stock_mode: raw.stock_mode } : {}),
      ...(raw.buy_price !== undefined ? { buy_price: Number(raw.buy_price || 0) } : {}),
      ...(raw.selling_price !== undefined ? { selling_price: Number(raw.selling_price || 0) } : {}),
      ...(raw.low_stock_threshold !== undefined ? { low_stock_threshold: Number(raw.low_stock_threshold || 0) } : {}),
      ...(raw.notes !== undefined ? { notes: raw.notes ? String(raw.notes).trim() : null } : {}),
      ...(raw.period_id !== undefined ? { period_id: raw.period_id ? Number(raw.period_id) : null } : {}),
      ...(raw.is_active !== undefined ? { is_active: Boolean(raw.is_active) } : {}),
    };

    return this.prisma.$transaction(async tx => {
      await tx.product.update({
        where: { id },
        data,
      });

      if (stock_quantity !== undefined) {
        return this.stockService.adjustStock(tx, id, Number(stock_quantity), user_id, 'Penyesuaian stok melalui form produk.');
      }
      return tx.product.findUniqueOrThrow({ where: { id } });
    });
  }

  async remove(id: number, user_id?: number) {
    return this.prisma.product.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });
  }
}
