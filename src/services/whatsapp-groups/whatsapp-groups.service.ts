import { Injectable, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

const INITIAL_WHATSAPP_GROUPS = [
  {
    name: 'WORTHTOBUY VIP Members',
    url: 'https://chat.whatsapp.com/VIPWorthtobuyCommunity',
    description: 'Exclusive community group for VIP & high-volume jastip customers with early bird access.',
    is_active: true,
  },
  {
    name: 'Jastip Singapore & Bangkok Batch 1',
    url: 'https://chat.whatsapp.com/JastipSGBKKBatch1',
    description: 'Active shopping group for Singapore and Bangkok live shopping flash sales.',
    is_active: true,
  },
  {
    name: 'Ready Stock & Flash Sale Alert',
    url: 'https://chat.whatsapp.com/ReadyStockFlashSale',
    description: 'Public member group for ready stock items and leftover stock sale notifications.',
    is_active: true,
  },
];

@Injectable()
export class WhatsappGroupsService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSeedData();
  }

  async ensureSeedData() {
    try {
      const count = await this.prisma.whatsapp_group.count({ where: { deleted_at: null } });
      if (count === 0) {
        const createdGroups: any[] = [];
        for (const item of INITIAL_WHATSAPP_GROUPS) {
          const group = await this.prisma.whatsapp_group.create({ data: item });
          createdGroups.push(group);
        }

        // Map initial customers to groups to demonstrate distribution
        const customers = await this.prisma.customer.findMany({
          where: { deleted_at: null, whatsapp_group_id: null },
          take: 15,
        });

        for (let i = 0; i < customers.length; i++) {
          const groupIndex = i % createdGroups.length;
          await this.prisma.customer.update({
            where: { id: customers[i].id },
            data: { whatsapp_group_id: createdGroups[groupIndex].id },
          });
        }
      }
    } catch {
      // Ignore if table not ready yet
    }
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = query.limit ? Math.min(500, Math.max(1, Number(query.limit))) : 100;
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim().slice(0, 100);
    const isActive =
      query.isActive !== undefined
        ? query.isActive === 'true' || query.isActive === true
        : query.is_active !== undefined
        ? query.is_active === 'true' || query.is_active === true
        : undefined;

    const where: any = {
      deleted_at: null,
      ...(isActive !== undefined ? { is_active: isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { url: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rawRows, total] = await Promise.all([
      this.prisma.whatsapp_group.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
        include: {
          _count: {
            select: {
              customers: {
                where: { deleted_at: null },
              },
            },
          },
        },
      }),
      this.prisma.whatsapp_group.count({ where }),
    ]);

    const data = rawRows.map((row) => ({
      ...row,
      customerCount: row._count?.customers || 0,
      total_customers: row._count?.customers || 0,
    }));

    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const group = await this.prisma.whatsapp_group.findFirst({
      where: { id, deleted_at: null },
      include: {
        _count: {
          select: {
            customers: {
              where: { deleted_at: null },
            },
          },
        },
        customers: {
          where: { deleted_at: null },
          select: {
            id: true,
            customer_code: true,
            full_name: true,
            whatsapp: true,
            segment: true,
            status: true,
            city: true,
          },
          orderBy: { full_name: 'asc' },
          take: 200,
        },
      },
    });

    if (!group) {
      throw new NotFoundException(`WhatsApp group with ID ${id} not found`);
    }

    return {
      ...group,
      customerCount: group._count?.customers || 0,
      total_customers: group._count?.customers || 0,
    };
  }

  private cleanData(body: any) {
    const name = String(body.name || '').trim();
    if (!name) {
      throw new BadRequestException('Group name is required.');
    }

    const urlRaw = body.url !== undefined ? body.url : body.url_wa_group !== undefined ? body.url_wa_group : body.urlWaGroup;
    const url = String(urlRaw || '').trim();
    if (!url) {
      throw new BadRequestException('WhatsApp Group URL / link is required.');
    }

    const description = body.description !== undefined ? (body.description ? String(body.description).trim() : null) : undefined;
    const isActive =
      body.is_active !== undefined
        ? Boolean(body.is_active)
        : body.isActive !== undefined
        ? Boolean(body.isActive)
        : true;

    return {
      name,
      url,
      ...(description !== undefined ? { description } : {}),
      is_active: isActive,
    };
  }

  async create(body: any, user_id?: number) {
    const data = this.cleanData(body);
    return this.prisma.whatsapp_group.create({
      data: {
        ...data,
        description: data.description ?? null,
      },
      include: {
        _count: {
          select: {
            customers: {
              where: { deleted_at: null },
            },
          },
        },
      },
    });
  }

  async update(id: number, body: any, user_id?: number) {
    await this.findOne(id);
    const data = this.cleanData(body);
    return this.prisma.whatsapp_group.update({
      where: { id },
      data,
      include: {
        _count: {
          select: {
            customers: {
              where: { deleted_at: null },
            },
          },
        },
      },
    });
  }

  async remove(id: number, user_id?: number) {
    await this.findOne(id);
    return this.prisma.whatsapp_group.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        deleted_by_id: user_id ?? null,
      },
    });
  }
}
