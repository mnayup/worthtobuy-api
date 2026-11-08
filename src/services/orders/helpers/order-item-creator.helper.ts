import { sequence } from '../../../common/utils/http.utils';
import { StockService } from '../../shared/stock.service';

export async function createOrderItemWithProduct(
  tx: any,
  item: any,
  orderId: number,
  fallbackPeriodId: number | null,
  userId: number | undefined,
  stockService: StockService,
  sharedProductId?: number | null
) {
  let pId = item.product_id || item.productId || (sharedProductId ?? null);
  const newProd = item.new_product || item.newProduct;
  const manualName = item.manual_product_name || item.manualProductName || item.name;

  let createdProductRecord: any = null;
  if ((!pId || pId === '__NEW_PRODUCT__') && (newProd || manualName)) {
    const pData = newProd || item;
    const stockQty = Number(pData.stock_quantity ?? pData.stockQuantity ?? 0);
    const prodCategory = (pData.category ? String(pData.category).trim() : null) || null;
    const prodBrand = (pData.brand_name || pData.brandName ? String(pData.brand_name || pData.brandName).trim() : null) || null;
    const prodName = (pData.name || pData.product_name || pData.productName || manualName ? String(pData.name || pData.product_name || pData.productName || manualName).trim() : 'New Product');

    const createdProduct = await tx.product.create({
      data: {
        sku: pData.sku || sequence('SKU'),
        name: prodName,
        category: prodCategory,
        brand_name: prodBrand,
        variant: pData.variant || pData.variation || item.variation || null,
        size: pData.size || item.size || null,
        store_location: pData.store_location || pData.storeLocation || null,
        product_url: pData.product_url || pData.productUrl || null,
        image_urls:
          pData.image_urls ||
          (pData.image_url || pData.imageUrl ? [pData.image_url || pData.imageUrl] : []),
        default_currency: pData.default_currency || pData.defaultCurrency || 'IDR',
        stock_mode: pData.stock_mode || pData.stockMode || 'EVENT',
        stock_quantity: stockQty,
        buy_price: Number(
          pData.buy_price ?? pData.buyPrice ?? pData.newProductBuyPrice ?? 0
        ),
        selling_price: Number(
          item.unit_price_foreign ??
            item.unitPriceForeign ??
            pData.selling_price ??
            pData.sellingPrice ??
            0
        ),
        period_id: pData.period_id || pData.periodId || fallbackPeriodId || null,
        notes: pData.notes || null,
      },
    });
    createdProductRecord = createdProduct;
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
  let resolvedProductSellingPrice = 0;
  let catalogProductName: string | null = createdProductRecord?.name || null;
  let catalogProductBrand: string | null = createdProductRecord?.brand_name || null;

  if (activeProductId) {
    const product = await tx.product.findUnique({
      where: { id: activeProductId },
      include: { period: true },
    });
    if (product) {
      catalogProductName = product.name;
      catalogProductBrand = product.brand_name;
      if (product.stock_mode === 'READY_STOCK' || product.period?.type === 'LIVE_SHOPPING') {
        sourceType = 'READY_STOCK';
      }
      resolvedProductSellingPrice = Number(product.selling_price || 0);
      const vpRaw: any = product.variant_prices;
      const vRules: any[] = Array.isArray(vpRaw)
        ? vpRaw
        : Array.isArray(vpRaw?.variantRules)
          ? vpRaw.variantRules
          : [];
      if (vRules.length > 0) {
        const iv = String(item.variation || '').trim().toLowerCase();
        const isz = String(item.size || '').trim().toLowerCase();
        for (const r of vRules) {
          const rVars = (Array.isArray(r.variants) ? r.variants : []).map((x: any) => String(x).trim().toLowerCase());
          const rSizes = (Array.isArray(r.sizes) ? r.sizes : []).map((x: any) => String(x).trim().toLowerCase());
          const vMatch = rVars.length === 0 || (iv && rVars.includes(iv));
          const sMatch = rSizes.length === 0 || (isz && rSizes.includes(isz));
          if (vMatch && sMatch && Number(r.sellingPrice || 0) > 0) {
            resolvedProductSellingPrice = Number(r.sellingPrice);
            break;
          }
        }
      }
    }
  }
  if (fallbackPeriodId && sourceType !== 'READY_STOCK') {
    const fallbackPeriod = await tx.jastip_period.findUnique({
      where: { id: Number(fallbackPeriodId) },
    });
    if (fallbackPeriod?.type === 'LIVE_SHOPPING' || fallbackPeriod?.code === 'READY-STOCK') {
      sourceType = 'READY_STOCK';
    }
  }
  const fulfillmentStatus =
    item.fulfillment_status ||
    item.fulfillmentStatus ||
    (sourceType === 'READY_STOCK' ? 'AVAILABLE' : 'PENDING');
  const purchaseStatus = sourceType === 'READY_STOCK' ? 'PURCHASED' : 'PENDING';
  const keptUntil = fulfillmentStatus === 'KEPT' ? item.kept_until || item.keptUntil : null;
  const rawInputPrice = Number(item.unit_price_foreign ?? item.unitPriceForeign ?? 0);
  const unitPrice = rawInputPrice > 0 ? rawInputPrice : resolvedProductSellingPrice;
  const targetPrice = Number(item.target_price_idr ?? item.targetPriceIdr ?? unitPrice ?? 0);

  const finalManualProductName =
    item.manual_product_name ||
    item.manualProductName ||
    catalogProductName ||
    null;
  const finalBrandName =
    item.brand_name ||
    item.brandName ||
    catalogProductBrand ||
    null;

  const row = await tx.order_item.create({
    data: {
      order_id: orderId,
      product_id: activeProductId || null,
      manual_product_name: finalManualProductName,
      brand_name: finalBrandName,
      source_type: sourceType as any,
      fulfillment_status: fulfillmentStatus as any,
      purchase_status: purchaseStatus as any,
      kept_until: keptUntil,
      variation: item.variation || null,
      size: item.size || null,
      color: item.color || null,
      quantity: Number(item.quantity || 1),
      unit_price_foreign: unitPrice,
      target_price_idr: targetPrice,
      bundle_name: item.bundle_name || item.bundleName || null,
      purchase_notes: item.purchase_notes || item.purchaseNotes || null,
      photo_url: item.photo_url || item.photoUrl || null,
    },
  });

  if (sourceType === 'READY_STOCK' && activeProductId) {
    await stockService.reserveReadyStock(
      tx,
      activeProductId,
      Number(item.quantity || 1),
      userId,
      String(row.id)
    );
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
