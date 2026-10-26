import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { PERMISSION_CATALOG } from './roles.constants';

const BUILTIN_ROLES = ['OWNER', 'ADMIN', 'SHOPPER', 'FINANCE'];

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  getCatalog() {
    return PERMISSION_CATALOG;
  }

  async findAll() {
    const roles = await this.prisma.role.findMany({
      include: {
        _count: {
          select: { users: { where: { deleted_at: null } } },
        },
      },
      orderBy: { id: 'asc' },
    });

    return roles.map((role) => ({
      ...role,
      userCount: role._count.users,
    }));
  }

  async findOne(id: number) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: { where: { deleted_at: null } } },
        },
      },
    });
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
    return {
      ...role,
      userCount: role._count.users,
    };
  }

  async create(body: { name: string; description?: string; can_view_profit?: boolean; permissions?: string[] }) {
    const cleanName = body.name.trim().toUpperCase();
    if (!cleanName) {
      throw new BadRequestException('Role name is required');
    }

    const existing = await this.prisma.role.findUnique({
      where: { name: cleanName },
    });
    if (existing) {
      throw new ConflictException(`Role '${cleanName}' already exists`);
    }

    const permissions = Array.isArray(body.permissions) ? body.permissions : [];

    const newRole = await this.prisma.role.create({
      data: {
        name: cleanName,
        description: body.description?.trim() || null,
        can_view_profit: Boolean(body.can_view_profit),
        permissions: permissions as any,
      },
    });

    if (permissions.length > 0) {
      await this.prisma.role_permission.createMany({
        data: permissions.map((p) => ({
          role_id: newRole.id,
          permission: p,
        })),
        skipDuplicates: true,
      });
    }

    return newRole;
  }

  async update(id: number, body: { name?: string; description?: string; can_view_profit?: boolean; permissions?: string[] }) {
    const target = await this.prisma.role.findUniqueOrThrow({ where: { id } });

    const updateData: any = {};
    if (body.description !== undefined) {
      updateData.description = body.description?.trim() || null;
    }
    if (body.can_view_profit !== undefined) {
      updateData.can_view_profit = Boolean(body.can_view_profit);
    }
    let finalPermissions: string[] | undefined = undefined;
    if (body.permissions !== undefined) {
      // If updating OWNER, ensure '*' remains
      if (target.name === 'OWNER' && !body.permissions.includes('*')) {
        finalPermissions = ['*', ...body.permissions];
      } else {
        finalPermissions = body.permissions;
      }
      updateData.permissions = finalPermissions;
    }
    if (body.name && body.name.trim().toUpperCase() !== target.name) {
      if (BUILTIN_ROLES.includes(target.name)) {
        throw new BadRequestException(`Cannot rename built-in system role '${target.name}'`);
      }
      const newName = body.name.trim().toUpperCase();
      const existing = await this.prisma.role.findUnique({ where: { name: newName } });
      if (existing) {
        throw new ConflictException(`Role '${newName}' already exists`);
      }
      updateData.name = newName;
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: updateData,
    });

    if (finalPermissions !== undefined) {
      await this.prisma.role_permission.deleteMany({ where: { role_id: id } });
      if (finalPermissions.length > 0) {
        await this.prisma.role_permission.createMany({
          data: finalPermissions.map((p) => ({
            role_id: id,
            permission: p,
          })),
          skipDuplicates: true,
        });
      }
    }

    return updated;
  }

  async remove(id: number) {
    const target = await this.prisma.role.findUniqueOrThrow({
      where: { id },
      include: {
        _count: {
          select: { users: { where: { deleted_at: null } } },
        },
      },
    });

    if (BUILTIN_ROLES.includes(target.name)) {
      throw new BadRequestException(`Cannot delete built-in system role '${target.name}'`);
    }

    if (target._count.users > 0) {
      throw new BadRequestException(`Cannot delete role '${target.name}' because ${target._count.users} user(s) are assigned to it.`);
    }

    await this.prisma.role.delete({ where: { id } });
    return { success: true };
  }
}
