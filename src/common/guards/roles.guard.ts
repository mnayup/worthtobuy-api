import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      throw new ForbiddenException('Akses ditolak: role pengguna tidak ditemukan.');
    }

    // OWNER has unrestricted bypass access across all routes
    if (user.role === 'OWNER') {
      return true;
    }

    // Built-in role whitelist match
    if (requiredRoles.includes(user.role)) {
      return true;
    }

    // Dynamic Permission Fallback: Check if user's dynamic permissions grant access
    const userPerms: string[] = Array.isArray(user.permissions) ? user.permissions : [];
    if (userPerms.includes('*') || userPerms.includes('*:*')) {
      return true;
    }

    // Infer module from request URL (e.g. /invoices -> invoices, /orders -> orders)
    const req = context.switchToHttp().getRequest();
    const rawPath = (req.baseUrl || req.url || '').split('?')[0];
    const pathSegments = rawPath.replace(/^\/+/, '').split('/');
    const moduleName = pathSegments[0]; // e.g. 'invoices', 'orders', 'reports', 'expenses'

    if (moduleName) {
      const method = (req.method || 'GET').toUpperCase();
      let inferredAction = 'view';
      if (method === 'POST') inferredAction = 'create';
      else if (method === 'PUT' || method === 'PATCH') inferredAction = 'edit';
      else if (method === 'DELETE') inferredAction = 'delete';

      const hasExact = userPerms.includes(`${moduleName}:${inferredAction}`);
      const hasModuleWildcard = userPerms.includes(`${moduleName}:*`);
      const hasAnyInModule = userPerms.some((p) => p.startsWith(`${moduleName}:`));

      if (hasExact || hasModuleWildcard || (inferredAction === 'view' && hasAnyInModule)) {
        return true;
      }
    }

    throw new ForbiddenException(`Role ${user.role} tidak memiliki akses ke endpoint ini.`);
  }
}

