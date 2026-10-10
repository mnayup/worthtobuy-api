export function sanitizeUserData(user: any) {
  const {
    password_hash,
    passwordHash,
    mfa_secret,
    mfaSecret,
    mfa_recovery_codes,
    mfaRecoveryCodes,
    ...safe
  } = user;
  return safe;
}

export function mapUserProfile(user: any) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatar_url ?? user.avatarUrl,
    avatar_url: user.avatar_url ?? user.avatarUrl,
    isActive: user.is_active ?? user.isActive,
    is_active: user.is_active ?? user.isActive,
    mfaEnabled: user.mfa_enabled ?? user.mfaEnabled,
    mfa_enabled: user.mfa_enabled ?? user.mfaEnabled,
    role: user.role?.name || user.role,
    roleDescription: user.role?.description,
    canViewProfit: user.role?.can_view_profit ?? user.role?.canViewProfit,
    permissions: user.role?.permissions,
    createdAt: user.created_at ?? user.createdAt,
    created_at: user.created_at ?? user.createdAt,
  };
}

export function buildUserWhereClause(query: any) {
  const search = String(query.search || '').trim().slice(0, 100);
  const roleFilter = query.role && query.role !== 'ALL' ? String(query.role) : undefined;

  return {
    deleted_at: null,
    ...(roleFilter ? { role: { name: { equals: roleFilter, mode: 'insensitive' as const } } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { username: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { role: { name: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}
