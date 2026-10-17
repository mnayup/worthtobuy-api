import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to enforce fine-grained permissions (e.g. 'products:delete', 'products:edit', 'customers:create').
 * Can accept one or multiple permission keys.
 * If multiple are passed, by default any match or all matches can be enforced.
 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
