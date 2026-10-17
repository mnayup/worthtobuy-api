import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no specific permissions are required on this handler/controller, pass through
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('Akses ditolak: pengguna belum diautentikasi.');
    }

    // OWNER has unrestricted bypass access
    if (user.role === 'OWNER') {
      return true;
    }

    const userPerms: string[] = Array.isArray(user.permissions) ? user.permissions : [];

    // Global wildcard access
    if (userPerms.includes('*') || userPerms.includes('*:*')) {
      return true;
    }

    // Check if user satisfies the required permissions
    // Every required permission must be matched by an exact key, a module wildcard (e.g. 'products:*'), or '*'
    const hasAll = requiredPermissions.every((required) => {
      if (userPerms.includes(required)) return true;

      const [mod] = required.split(':');
      if (mod && userPerms.includes(`${mod}:*`)) {
        return true;
      }

      return false;
    });

    if (!hasAll) {
      throw new ForbiddenException(
        `Akses ditolak: akun Anda tidak memiliki izin [${requiredPermissions.join(', ')}] untuk tindakan ini.`
      );
    }

    return true;
  }
}
