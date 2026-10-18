import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

const INITIAL_SHIPPING_COUNTERS = [
  {
    name: 'JNE',
    courier: 'JNE',
    code: 'JNE',
    notes: 'Layanan Reguler (REG), YES (Yakin Esok Sampai), & JTR (JNE Trucking/Cargo). Jaringan terluas ke seluruh Indonesia.',
    is_active: true,
  },
  {
    name: 'J&T Express',
    courier: 'J&T Express',
    code: 'J&T',
    notes: 'Layanan EZ (Reguler), J&T Super (Next Day), & J&T Cargo. Operasional pengiriman 365 hari tanpa libur.',
    is_active: true,
  },
  {
    name: 'SiCepat',
    courier: 'SiCepat',
    code: 'SICEPAT',
    notes: 'Layanan SIUNTUNG (Reguler), BEST (Besok Sampai Tujuan), & GOKIL (Cargo Kilat).',
    is_active: true,
  },
  {
    name: 'Paxel',
    courier: 'Paxel',
    code: 'PAXEL',
    notes: 'Spesialis Same Day Delivery antar kota, paket makanan, dan cold-chain terpercaya.',
    is_active: true,
  },
  {
    name: 'Lion Parcel',
    courier: 'Lion Parcel',
    code: 'LION',
    notes: 'Layanan REGPACK, ONEPACK (Next Day), & JAGOPACK didukung armada pesawat Lion Group.',
    is_active: true,
  },
  {
    name: 'Anteraja',
    courier: 'Anteraja',
    code: 'ANTERAJA',
    notes: 'Layanan Reguler, Next Day, dan Same Day dengan penjemputan paket oleh Satria.',
    is_active: true,
  },
  {
    name: 'POS Indonesia',
    courier: 'POS Indonesia',
    code: 'POS',
    notes: 'Layanan Pos Reguler, Pos Kilat Khusus, & Pos Next Day dengan jangkauan pelosok & kecamatan terpencil.',
    is_active: true,
  },
  {
    name: 'TIKI',
    code: 'TIKI',
    courier: 'TIKI',
    notes: 'Layanan ONS (Over Night Services), REG, ECO, dan TRC (Trucking).',
    is_active: true,
  },
  {
    name: 'Ninja Xpress',
    courier: 'Ninja Xpress',
    code: 'NINJA',
    notes: 'Layanan Ninja Standard dan Ninja Fast untuk e-commerce dan pengiriman paket retail.',
    is_active: true,
  },
  {
    name: 'GoSend',
    courier: 'GoSend',
    code: 'GOSEND',
    notes: 'Pengiriman kilat point-to-point roda dua dalam kota (Instant & Same Day Delivery).',
    is_active: true,
  },
  {
    name: 'GrabExpress',
    courier: 'GrabExpress',
    code: 'GRAB',
    notes: 'Pengiriman kurir kilat on-demand dalam kota armada motor & mobil (Instant Bike & Car).',
    is_active: true,
  },
];

@Injectable()
export class ShippingCountersService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSeedData();
  }

  async ensureSeedData() {
    try {
      const count = await this.prisma.shipping_counter.count({ where: { deleted_at: null } });
      if (count === 0) {
        for (const item of INITIAL_SHIPPING_COUNTERS) {
          await this.prisma.shipping_counter.create({
            data: {
              ...item,
              notes: 'Default master courier / ekspedisi',
            },
          });
        }
      }
    } catch {
      // Ignore if table not yet migrated during initial boot
    }
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = query.limit ? Math.min(500, Math.max(1, Number(query.limit))) : 100;
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim().slice(0, 100);
    const courier = query.courier && query.courier !== 'ALL' ? String(query.courier) : undefined;
    const isActive =
      query.isActive !== undefined
        ? query.isActive === 'true' || query.isActive === true
        : query.is_active !== undefined
        ? query.is_active === 'true' || query.is_active === true
        : undefined;

    const where: any = {
      deleted_at: null,
      ...(courier ? { courier: { contains: courier, mode: 'insensitive' } } : {}),
      ...(isActive !== undefined ? { is_active: isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { courier: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
              { address: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { contact_person: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.shipping_counter.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.shipping_counter.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: number) {
    return this.prisma.shipping_counter.findFirstOrThrow({
      where: { id, deleted_at: null },
    });
  }

  private cleanData(body: any) {
    const name = String(body.name || '').trim();
    if (!name) {
      throw new BadRequestException('Nama kurir / ekspedisi wajib diisi.');
    }
    const courier = body.courier ? String(body.courier).trim() : name;
    const code = body.code ? String(body.code).trim() : null;
    const tracking_url = body.tracking_url ?? body.trackingUrl;
    const trackingUrl = tracking_url ? String(tracking_url).trim() : null;
    const address = body.address ? String(body.address).trim() : null;
    const city = body.city ? String(body.city).trim() : null;
    const phone = body.phone ? String(body.phone).trim() : null;
    const contact_person =
      body.contact_person !== undefined
        ? body.contact_person ? String(body.contact_person).trim() : null
        : body.contactPerson
        ? String(body.contactPerson).trim()
        : null;

    const is_active =
      body.is_active !== undefined
        ? Boolean(body.is_active)
        : body.isActive !== undefined
        ? Boolean(body.isActive)
        : true;

    const notes = body.notes ? String(body.notes).trim() : null;

    return {
      name,
      courier,
      code,
      tracking_url: trackingUrl,
      address,
      city,
      phone,
      contact_person,
      is_active,
      notes,
    };
  }

  async create(body: any, user_id?: number) {
    const data = this.cleanData(body);
    return this.prisma.shipping_counter.create({
      data,
    });
  }

  async update(id: number, body: any, user_id?: number) {
    await this.findOne(id);
    const data = this.cleanData(body);
    return this.prisma.shipping_counter.update({
      where: { id },
      data,
    });
  }

  async remove(id: number, user_id?: number) {
    await this.findOne(id);
    return this.prisma.shipping_counter.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        deleted_by_id: user_id ?? null,
      },
    });
  }
}
