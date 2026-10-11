import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) { }

  async reserveReadyStock(db: any, productId: number, quantity: number, userId?: number, referenceId?: string) {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    const stockMode = product.stock_mode ?? product.stockMode;
    if (!['READY_STOCK', 'BOTH'].includes(stockMode)) {
      throw new BadRequestException(`${product.name} bukan produk ready stock.`);
    }
    const stockQty = Number(product.stock_quantity ?? product.stockQuantity ?? 0);
    const reservedQty = Number(product.reserved_quantity ?? product.reservedQuantity ?? 0);
    const available = stockQty - reservedQty;
    if (available < quantity) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup. Tersedia ${available}, diminta ${quantity}.`);
    }
    const updated = await db.product.update({
      where: { id: productId },
      data: { reserved_quantity: { increment: quantity } },
    });
    const balanceAfter = Number(updated.stock_quantity ?? updated.stockQuantity ?? 0);
    await db.inventory_movement.create({
      data: {
        product_id: productId,
        movement_type: 'RESERVE',
        quantity,
        balance_after: balanceAfter,
        reference_type: 'ORDER_ITEM',
        reference_id: referenceId,
        notes: 'Stok dialokasikan untuk pesanan.',
        user_id: userId,
      },
    });
    return updated;
  }

  async releaseReadyStock(
    db: any,
    productId: number,
    quantity: number,
    userId?: number,
    referenceId?: string,
    notes = 'Reservasi stok dilepas.'
  ) {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    const reservedQty = Number(product.reserved_quantity ?? product.reservedQuantity ?? 0);
    const release = Math.min(quantity, reservedQty);
    if (release <= 0) return product;
    const updated = await db.product.update({
      where: { id: productId },
      data: { reserved_quantity: { decrement: release } },
    });
    const balanceAfter = Number(updated.stock_quantity ?? updated.stockQuantity ?? 0);
    await db.inventory_movement.create({
      data: {
        product_id: productId,
        movement_type: 'RELEASE',
        quantity: release,
        balance_after: balanceAfter,
        reference_type: 'ORDER_ITEM',
        reference_id: referenceId,
        notes,
        user_id: userId,
      },
    });
    return updated;
  }

  async consumeReadyStock(db: any, productId: number, quantity: number, userId?: number, referenceId?: string) {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    const stockQty = Number(product.stock_quantity ?? product.stockQuantity ?? 0);
    const reservedQty = Number(product.reserved_quantity ?? product.reservedQuantity ?? 0);
    if (stockQty < quantity) {
      throw new BadRequestException(`Stok fisik ${product.name} tidak cukup untuk dikirim.`);
    }
    const reservedRelease = Math.min(quantity, reservedQty);
    const updated = await db.product.update({
      where: { id: productId },
      data: {
        stock_quantity: { decrement: quantity },
        ...(reservedRelease > 0 ? { reserved_quantity: { decrement: reservedRelease } } : {}),
      },
    });
    const balanceAfter = Number(updated.stock_quantity ?? updated.stockQuantity ?? 0);
    await db.inventory_movement.create({
      data: {
        product_id: productId,
        movement_type: 'OUT',
        quantity: -quantity,
        balance_after: balanceAfter,
        reference_type: 'ORDER_ITEM',
        reference_id: referenceId,
        notes: 'Ready stock dikirim kepada pelanggan.',
        user_id: userId,
      },
    });
    return updated;
  }

  async adjustStock(db: any, productId: number, newQuantity: number, userId?: number, notes?: string) {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    const stockQty = Number(product.stock_quantity ?? product.stockQuantity ?? 0);
    const reservedQty = Number(product.reserved_quantity ?? product.reservedQuantity ?? 0);
    if (newQuantity < reservedQty) {
      throw new BadRequestException(`Stok baru tidak boleh lebih kecil dari stok terpesan (${reservedQty}).`);
    }
    const difference = newQuantity - stockQty;
    const updated = await db.product.update({
      where: { id: productId },
      data: { stock_quantity: newQuantity },
    });
    if (difference !== 0) {
      await db.inventory_movement.create({
        data: {
          product_id: productId,
          movement_type: 'ADJUSTMENT',
          quantity: difference,
          balance_after: newQuantity,
          reference_type: 'PRODUCT',
          reference_id: String(productId),
          notes: notes || 'Penyesuaian stok dari database produk.',
          user_id: userId,
        },
      });
    }
    return updated;
  }
}
