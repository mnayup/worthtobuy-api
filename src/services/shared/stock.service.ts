import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) { }

  async reserveReadyStock(db: any, productId: number, quantity: number, userId?: number, referenceId?: string) {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    if (!['READY_STOCK', 'BOTH'].includes(product.stockMode)) {
      throw new BadRequestException(`${product.name} bukan produk ready stock.`);
    }
    const available = product.stockQuantity - product.reservedQuantity;
    if (available < quantity) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup. Tersedia ${available}, diminta ${quantity}.`);
    }
    const updated = await db.product.update({
      where: { id: productId },
      data: { reservedQuantity: { increment: quantity } },
    });
    await db.inventoryMovement.create({
      data: {
        productId,
        movementType: 'RESERVE',
        quantity,
        balanceAfter: updated.stockQuantity,
        referenceType: 'ORDER_ITEM',
        referenceId,
        notes: 'Stok dialokasikan untuk pesanan.',
        userId,
      },
    });
    return updated;
  }

  async releaseReadyStock(db: any, productId: number, quantity: number, userId?: number, referenceId?: string, notes = 'Reservasi stok dilepas.') {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    const release = Math.min(quantity, product.reservedQuantity);
    if (release <= 0) return product;
    const updated = await db.product.update({
      where: { id: productId },
      data: { reservedQuantity: { decrement: release } },
    });
    await db.inventoryMovement.create({
      data: {
        productId,
        movementType: 'RELEASE',
        quantity: release,
        balanceAfter: updated.stockQuantity,
        referenceType: 'ORDER_ITEM',
        referenceId,
        notes,
        userId,
      },
    });
    return updated;
  }

  async consumeReadyStock(db: any, productId: number, quantity: number, userId?: number, referenceId?: string) {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    if (product.stockQuantity < quantity) {
      throw new BadRequestException(`Stok fisik ${product.name} tidak cukup untuk dikirim.`);
    }
    const reservedRelease = Math.min(quantity, product.reservedQuantity);
    const updated = await db.product.update({
      where: { id: productId },
      data: {
        stockQuantity: { decrement: quantity },
        ...(reservedRelease > 0 ? { reservedQuantity: { decrement: reservedRelease } } : {}),
      },
    });
    await db.inventoryMovement.create({
      data: {
        productId,
        movementType: 'OUT',
        quantity: -quantity,
        balanceAfter: updated.stockQuantity,
        referenceType: 'ORDER_ITEM',
        referenceId,
        notes: 'Ready stock dikirim kepada pelanggan.',
        userId,
      },
    });
    return updated;
  }

  async adjustStock(db: any, productId: number, newQuantity: number, userId?: number, notes?: string) {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    if (newQuantity < product.reservedQuantity) {
      throw new BadRequestException(`Stok baru tidak boleh lebih kecil dari stok terpesan (${product.reservedQuantity}).`);
    }
    const difference = newQuantity - product.stockQuantity;
    const updated = await db.product.update({ where: { id: productId }, data: { stockQuantity: newQuantity } });
    if (difference !== 0) {
      await db.inventoryMovement.create({
        data: {
          productId,
          movementType: 'ADJUSTMENT',
          quantity: difference,
          balanceAfter: newQuantity,
          referenceType: 'PRODUCT',
          referenceId: String(productId),
          notes: notes || 'Penyesuaian stok dari database produk.',
          userId,
        },
      });
    }
    return updated;
  }
}
