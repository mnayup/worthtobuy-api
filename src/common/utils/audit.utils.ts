// Audit logging has been removed across the project.
// This function remains as an asynchronous no-op to maintain full backwards compatibility.
export async function auditLog(
  _prisma?: any,
  _userId?: number | undefined,
  _action?: string,
  _entity?: string,
  _entityId?: string,
  _metadata?: any,
  _ipAddress?: string,
): Promise<void> {
  // no-op
}
