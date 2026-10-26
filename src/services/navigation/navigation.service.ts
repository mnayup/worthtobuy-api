import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

export interface NavigationItemDto {
  key: string;
  label: string;
  path: string;
  icon: string;
  group_title: string;
  parent_id?: number | null;
  sort_order?: number;
  permission_key?: string | null;
  is_active?: boolean;
}

@Injectable()
export class NavigationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Return all navigation items structured by group, filtered for the active user if user permissions are provided.
   */
  async getNavigationTree(userRole?: string, userPermissions?: string[]) {
    const isOwner = userRole === 'OWNER';
    const hasWildcard = userPermissions?.includes('*') || userPermissions?.includes('*:*');

    const allItems = await this.prisma.navigation_item.findMany({
      where: { is_active: true },
      orderBy: [{ group_title: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }],
      include: {
        sub_items: {
          where: { is_active: true },
          orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        },
      },
    });

    // Top-level items only (parent_id === null)
    const topLevel = allItems.filter((item) => !item.parent_id);

    const canAccess = (item: { permission_key: string | null; path: string }) => {
      if (isOwner || hasWildcard) return true;
      if (!userPermissions || userPermissions.length === 0) return false;
      const permKey = item.permission_key || item.path.replace(/^\//, '') || 'dashboard';
      if (userPermissions.includes(permKey)) return true;
      if (userPermissions.includes(`${permKey}:view`)) return true;
      if (userPermissions.includes(`${permKey}:*`)) return true;
      if (userPermissions.some((p) => p.startsWith(`${permKey}:`))) return true;
      return false;
    };

    // Filter top-level items and sub-items based on permissions
    const accessibleItems = topLevel
      .map((item) => {
        const accessibleSub = (item.sub_items || []).filter((sub) => canAccess(sub));
        const selfAccessible = canAccess(item);

        if (!selfAccessible && accessibleSub.length === 0) {
          return null;
        }

        return {
          id: item.id,
          key: item.key,
          label: item.label,
          path: item.path,
          icon: item.icon,
          group_title: item.group_title,
          sort_order: item.sort_order,
          permission_key: item.permission_key,
          sub_items: accessibleSub.map((sub) => ({
            id: sub.id,
            key: sub.key,
            label: sub.label,
            path: sub.path,
            icon: sub.icon,
            group_title: sub.group_title,
            sort_order: sub.sort_order,
            permission_key: sub.permission_key,
          })),
        };
      })
      .filter(Boolean);

    // Group items by group_title preserving ordering
    const groupOrder = ['Main', 'Master Data', 'Operations', 'Finance', 'System'];
    const groupsMap = new Map<string, any[]>();

    for (const item of accessibleItems) {
      if (!item) continue;
      const list = groupsMap.get(item.group_title) || [];
      list.push(item);
      groupsMap.set(item.group_title, list);
    }

    const result = [];
    for (const title of groupOrder) {
      if (groupsMap.has(title)) {
        result.push({
          title,
          items: groupsMap.get(title),
        });
        groupsMap.delete(title);
      }
    }
    // Any other custom groups
    for (const [title, items] of groupsMap.entries()) {
      result.push({ title, items });
    }

    return result;
  }

  /**
   * Return flat list of all navigation items (for admin management)
   */
  async findAll() {
    return this.prisma.navigation_item.findMany({
      orderBy: [{ group_title: 'asc' }, { sort_order: 'asc' }],
      include: {
        sub_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async update(id: number, data: Partial<NavigationItemDto>) {
    const existing = await this.prisma.navigation_item.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Navigation item not found');

    return this.prisma.navigation_item.update({
      where: { id },
      data: {
        ...(data.label && { label: data.label.trim() }),
        ...(data.path && { path: data.path.trim() }),
        ...(data.icon && { icon: data.icon.trim() }),
        ...(data.group_title && { group_title: data.group_title.trim() }),
        ...(data.sort_order !== undefined && { sort_order: data.sort_order }),
        ...(data.permission_key !== undefined && { permission_key: data.permission_key }),
        ...(data.is_active !== undefined && { is_active: data.is_active }),
      },
    });
  }
}
