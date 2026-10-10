import { sequence } from '../../../common/utils/http.utils';
import { StockService } from '../../shared/stock.service';

export async function createOrderItemWithProduct(
  tx: any,
  item: any,
  orderId: number,
  fallbackPeriodId: number | null,
  userId: number | undefined,
  stockService: StockService
) {
  const pId = item.product_id || item.productId;
  const newProd = item.new_product || item.newProduct;
  const manualName = item.manual_product_name || item.manualProductName || item.name;

  if ((!pId || pId === '__NEW_PRODUCT__') && (newProd || manualName)) {
    const pData = newProd || item;
    const stockQty = Number(pData.stock_quantity ?? pData.stockQuantity ?? 0);
    const createdProduct = await tx.product.create({
      data: {
        sku: pData.sku || sequence('SKU'),
        name: pData.name || pData.product_name || pData.productName || manualName || 'New Product',
        category: pData.category || null,
        brand_name: pData.brand_name || pData.brandName || null,
        store_location: pData.store_location || pData.storeLocation || null,
        product_url: pData.product_url || pData.productUrl || null,
        image_url: pData.image_url || pData.imageUrl || null,
        default_currency: pData.default_currency || pData.defaultCurrency || 'IDR',
        stock_mode: pData.stock_mode || pData.stockMode || 'EVENT',
        stock_quantity: stockQty,
        buy_price: Number(pData.buy_price ?? pData.buyPrice ?? 0),
        selling_price: Number(
          item.unit_price_foreign ?? item.unitPriceForeign ?? pData.selling_price ?? pData.sellingPrice ?? 0
        ),
        period_id: pData.period_id || pData.periodId || fallbackPeriodId || null,
        notes: pData.notes || null,
      },
    });
    item.product_id = createdProduct.id;
    item.productId = createdProduct.id;
    if (stockQty > 0) {
      await tx.inventory_movement.create({
        data: {
          product_id: createdProduct.id,
          movement_type: 'INITIAL',
          quantity: stockQty,
          balance_after: stockQty,
          reference_type: 'PRODUCT',
          reference_id: String(createdProduct.id),
          notes: 'Stok awal produk dari pesanan baru.',
          user_id: userId,
        },
      });
    }
  }

  const activeProductId = item.product_id || item.productId;
  let sourceType = item.source_type || item.sourceType || 'CATALOG';
  if (activeProductId) {
    const product = await tx.product.findUnique({ where: { id: activeProductId } });
    if (product && product.stock_mode === 'READY_STOCK') {
      sourceType = 'READY_STOCK';
    }
  }
  const fulfillmentStatus =
    item.fulfillment_status || item.fulfillmentStatus || (sourceType === 'READY_STOCK' ? 'AVAILABLE' : 'PENDING');
  const keptUntil = fulfillmentStatus === 'KEPT' ? item.kept_until || item.keptUntil : null;
  const unitPrice = Number(item.unit_price_foreign ?? item.unitPriceForeign ?? 0);
  const targetPrice = Number(item.target_price_idr ?? item.targetPriceIdr ?? unitPrice ?? 0);

  const row = await tx.order_item.create({
    data: {
      order_id: orderId,
      product_id: activeProductId || null,
      manual_product_name: item.manual_product_name || item.manualProductName || null,
      brand_name: item.brand_name || item.brandName || null,
      source_type: sourceType as any,
      fulfillment_status: fulfillmentStatus as any,
      kept_until: keptUntil,
      variation: item.variation || null,
      size: item.size || null,
      color: item.color || null,
      quantity: Number(item.quantity || 1),
      unit_price_foreign: unitPrice,
      target_price_idr: targetPrice,
      purchase_notes: item.purchase_notes || item.purchaseNotes || null,
      photo_url: item.photo_url || item.photoUrl || null,
    },
  });

  if (sourceType === 'READY_STOCK' && activeProductId) {
    await stockService.reserveReadyStock(tx, activeProductId, Number(item.quantity || 1), userId, String(row.id));
  }

  await tx.item_status_history.create({
    data: {
      order_item_id: row.id,
      to_status: fulfillmentStatus,
      notes: 'Status item pesanan.',
      user_id: userId,
    },
  });

  return row;
}
