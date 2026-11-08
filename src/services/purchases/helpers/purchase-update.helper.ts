import { PrismaService } from '../../../config/prisma/prisma.service';
import { RefundService } from '../../shared/refund.service';
import { StockService } from '../../shared/stock.service';
import {
  handlePurchasedTransitionHelper,
  handleUnavailableTransitionHelper,
} from './purchase-transitions.helper';
import {
  embedSortingIntoNotes,
  extractSortingFromNotes,
} from './purchase-consolidation.helper';

export function cleanPurchaseData(body: any): any {
  if (!body || typeof body !== 'object') return {};
  const cleaned: any = {};

  const pNum = body.purchase_number ?? body.purchaseNumber;
  if (pNum !== undefined) cleaned.purchase_number = pNum ? String(pNum).trim() : undefined;

  const pDate = body.purchase_date ?? body.purchaseDate;
  if (pDate !== undefined) cleaned.purchase_date = pDate ? new Date(pDate) : new Date();

  const oItemId = body.order_item_id ?? body.orderItemId;
  if (oItemId !== undefined && oItemId !== null) cleaned.order_item_id = Number(oItemId);

  const shopperId = body.shopper_id ?? body.shopperId;
  if (shopperId !== undefined) cleaned.shopper_id = shopperId ? Number(shopperId) : null;

  const periodId = body.period_id ?? body.periodId;
  if (periodId !== undefined && periodId !== null) cleaned.period_id = Number(periodId);

  const productId = body.product_id ?? body.productId;
  if (productId !== undefined) cleaned.product_id = productId ? Number(productId) : null;

  const brand = body.brand_name ?? body.brandName;
  if (brand !== undefined) cleaned.brand_name = brand ? String(brand).trim() : '-';

  if (body.quantity !== undefined) cleaned.quantity = Number(body.quantity || 1);

  const est = body.estimated_price ?? body.estimatedPrice;
  if (est !== undefined) cleaned.estimated_price = Number(est || 0);

  const act = body.actual_price ?? body.actualPrice;
  if (act !== undefined) cleaned.actual_price = Number(act || 0);

  if (body.status !== undefined) cleaned.status = body.status;

  const payMeth = body.payment_method ?? body.paymentMethod;
  if (payMeth !== undefined) cleaned.payment_method = payMeth ? String(payMeth).trim() : null;

  const recUrl =
    body.receipt_url ?? body.receiptUrl ?? body.receipt_photo_url ?? body.receiptPhotoUrl;
  if (recUrl !== undefined) cleaned.receipt_url = recUrl ? String(recUrl).trim() : null;

  if (body.notes !== undefined) cleaned.notes = body.notes ? String(body.notes).trim() : null;

  return cleaned;
}

export async function updateConsolidatedPurchaseHelper(
  prisma: PrismaService,
  refundService: RefundService,
  purchaseNumber: string,
  body: any,
  userId?: number,
  stockService?: StockService
) {
  const submittedItemIds = (body.items || [])
    .map((it: any) => Number(it.id || it.purchase_id))
    .filter((id: number) => Boolean(id) && !isNaN(id));
  const submittedOrderItemIds = (body.items || [])
    .map((it: any) => Number(it.order_item_id))
    .filter((id: number) => Boolean(id) && !isNaN(id));

  const rows = await prisma.purchase.findMany({
    where: {
      OR: [
        { purchase_number: purchaseNumber },
        ...(submittedItemIds.length ? [{ id: { in: submittedItemIds } }] : []),
        ...(submittedOrderItemIds.length ? [{ order_item_id: { in: submittedOrderItemIds } }] : []),
      ],
    },
    include: {
      period: true,
      order_item: {
        include: { order: { include: { customer: true } } },
      },
    },
  });

  const existingSorting = rows.reduce<any[]>((acc, r) => {
    if (acc.length > 0) return acc;
    return extractSortingFromNotes(r.notes).sortingLines;
  }, []);
  const existingCleanNotes = rows.reduce<string | null>((acc, r) => {
    if (acc !== null) return acc;
    return extractSortingFromNotes(r.notes).cleanNotes;
  }, null);

  const nextSortingLines = Array.isArray(body.sortingLines)
    ? body.sortingLines
    : existingSorting;
  const nextCleanNotes =
    body.notes !== undefined ? body.notes : existingCleanNotes;

  const commonData: any = {};
  if (body.paymentMethod !== undefined) commonData.payment_method = body.paymentMethod;
  if (body.receiptUrl !== undefined) commonData.receipt_url = body.receiptUrl;
  if (body.notes !== undefined || Array.isArray(body.sortingLines)) {
    commonData.notes = embedSortingIntoNotes(nextCleanNotes, nextSortingLines);
  }
  if (body.shopperId !== undefined) commonData.shopper_id = Number(body.shopperId) || null;

  const itemMap = new Map<number, any>();
  (body.items || []).forEach((it: any) => {
    if (it.order_item_id) itemMap.set(Number(it.order_item_id), it);
    if (it.id) itemMap.set(Number(it.id), it);
  });

  // Track newly added/updated variants and sizes per product so they are synced to product detail
  const productSpecsMap = new Map<number, { variants: Set<string>; sizes: Set<string>; buyPrices: number[] }>();
  const recordProductSpec = (productId?: number | null, variant?: string | null, size?: string | null, unitPrice?: number) => {
    if (!productId) return;
    if (!productSpecsMap.has(productId)) {
      productSpecsMap.set(productId, { variants: new Set(), sizes: new Set(), buyPrices: [] });
    }
    const spec = productSpecsMap.get(productId)!;
    const v = String(variant || '').trim();
    const s = String(size || '').trim();
    if (v && v !== '-' && v.toLowerCase() !== 'default') spec.variants.add(v);
    if (s && s !== '-') spec.sizes.add(s);
    if (unitPrice && unitPrice > 0) spec.buyPrices.push(unitPrice);
  };

  if (Array.isArray(body.newProductSpecs)) {
    for (const sp of body.newProductSpecs) {
      const pid = Number(sp.productId || sp.product_id || 0);
      if (pid > 0) {
        recordProductSpec(pid, sp.variant || sp.variation, sp.size, Number(sp.buyPrice || sp.unitPrice || 0));
      }
    }
  }

  for (const row of rows) {
    const itInput = (row.order_item_id ? itemMap.get(row.order_item_id) : undefined) || itemMap.get(row.id);
    const isRejected = Boolean(itInput?.is_rejected || itInput?.status === 'UNAVAILABLE');
    const isBought = Boolean(itInput?.is_bought ?? !isRejected);
    const rawKeptUntil = itInput?.kept_until !== undefined ? itInput.kept_until : itInput?.keptUntil;
    const keptUntilData = rawKeptUntil !== undefined ? (rawKeptUntil ? new Date(rawKeptUntil) : null) : undefined;
    const rawVariation = itInput?.variation !== undefined ? itInput.variation : itInput?.variant;
    const rawSize = itInput?.size !== undefined ? itInput.size : undefined;
    const nextVariation =
      rawVariation !== undefined
        ? (String(rawVariation || '').trim() && String(rawVariation || '').trim() !== 'Default'
            ? String(rawVariation).trim()
            : null)
        : undefined;
    const nextSize =
      rawSize !== undefined
        ? (String(rawSize || '').trim() && String(rawSize || '').trim() !== '-'
            ? String(rawSize).trim()
            : null)
        : undefined;
    const allocatedQty =
      itInput?.allocated_qty !== undefined
        ? Number(itInput.allocated_qty)
        : isRejected
          ? 0
          : row.quantity;
    const unitPrice =
      itInput?.actual_price !== undefined
        ? Number(itInput.actual_price)
        : Number(row.actual_price) / (row.quantity || 1);

    const activeProductId = row.product_id || row.order_item?.product_id || null;
    recordProductSpec(
      activeProductId,
      nextVariation !== undefined ? nextVariation : (row.variation || row.order_item?.variation),
      nextSize !== undefined ? nextSize : (row.size || row.order_item?.size),
      unitPrice
    );

    const specUpdateData: any = {};
    if (nextVariation !== undefined) specUpdateData.variation = nextVariation;
    if (nextSize !== undefined) specUpdateData.size = nextSize;

    // Handle manual Live Shopping purchase (no order_item_id)
    if (!row.order_item_id || !row.order_item) {
      const targetStatus = isRejected || allocatedQty <= 0 ? 'UNAVAILABLE' : isBought ? 'PURCHASED' : (itInput?.status === 'SORTING' ? 'SORTING' : 'WAITING_PURCHASE');
      const nextQty = Math.max(0, allocatedQty);
      const nextActual = targetStatus === 'UNAVAILABLE' ? 0 : unitPrice * (nextQty || row.quantity);
      const est = Number(row.estimated_price);

      await prisma.purchase.update({
        where: { id: row.id },
        data: {
          ...commonData,
          ...specUpdateData,
          ...(nextQty > 0 ? { quantity: nextQty } : {}),
          status: targetStatus as any,
          actual_price: nextActual,
          price_difference: targetStatus === 'UNAVAILABLE' ? 0 : nextActual - est,
        },
      });

      if (stockService && row.product_id && row.period?.type === 'LIVE_SHOPPING') {
        const oldEffectiveQty = row.status === 'PURCHASED' ? Number(row.quantity || 0) : 0;
        const newEffectiveQty = targetStatus === 'PURCHASED' ? (nextQty || Number(row.quantity || 0)) : 0;
        const delta = newEffectiveQty - oldEffectiveQty;
        if (delta !== 0) {
          await stockService.addStockFromPurchase(
            prisma,
            row.product_id,
            delta,
            userId,
            String(row.id),
            'Penyesuaian stok dari pembaruan pembelian Live Shopping.'
          );
        }
      }
      continue;
    }

    const order = row.order_item.order;
    const fromStatus = row.order_item.fulfillment_status;

    // Case 1: Completely Rejected / 0 allocated
    if (isRejected || allocatedQty <= 0) {
      await prisma.purchase.update({
        where: { id: row.id },
        data: {
          ...commonData,
          ...specUpdateData,
          status: 'UNAVAILABLE',
          actual_price: 0,
          price_difference: 0,
        },
      });

      if (Object.keys(specUpdateData).length > 0) {
        await prisma.order_item.update({
          where: { id: row.order_item_id },
          data: specUpdateData,
        });
      }

      await handleUnavailableTransitionHelper(
        prisma,
        refundService,
        order,
        row.order_item_id,
        fromStatus,
        userId
      );
      continue;
    }

    // Case 2: Partial Allocation (Shortage)
    if (allocatedQty < row.quantity) {
      const boughtActual = unitPrice * allocatedQty;
      const boughtEst = (Number(row.estimated_price) * allocatedQty) / row.quantity;

      // Update primary purchase and order_item for the bought quantity
      await prisma.purchase.update({
        where: { id: row.id },
        data: {
          ...commonData,
          ...specUpdateData,
          quantity: allocatedQty,
          status: 'PURCHASED',
          actual_price: boughtActual,
          estimated_price: boughtEst,
          price_difference: boughtActual - boughtEst,
        },
      });

      await prisma.order_item.update({
        where: { id: row.order_item_id },
        data: {
          ...specUpdateData,
          quantity: allocatedQty,
          ...(keptUntilData !== undefined ? { kept_until: keptUntilData } : {}),
        },
      });

      await handlePurchasedTransitionHelper(
        prisma,
        order,
        row.order_item_id,
        fromStatus,
        userId
      );
      continue;
    }

    // Case 3: Fully bought, waiting purchase, or sorting
    const rowStatus = itInput?.status === 'SORTING'
      ? 'SORTING'
      : isBought
        ? 'PURCHASED'
        : 'WAITING_PURCHASE';
    const rowActual = unitPrice * row.quantity;
    const est = Number(row.estimated_price);

    await prisma.purchase.update({
      where: { id: row.id },
      data: {
        ...commonData,
        ...specUpdateData,
        status: rowStatus as any,
        actual_price: rowActual,
        price_difference: rowActual - est,
      },
    });

    if (rowStatus === 'PURCHASED') {
      if (keptUntilData !== undefined || Object.keys(specUpdateData).length > 0) {
        await prisma.order_item.update({
          where: { id: row.order_item_id },
          data: {
            ...specUpdateData,
            ...(keptUntilData !== undefined ? { kept_until: keptUntilData } : {}),
          },
        });
      }

      await handlePurchasedTransitionHelper(
        prisma,
        order,
        row.order_item_id,
        fromStatus,
        userId
      );
    } else if (keptUntilData !== undefined || Object.keys(specUpdateData).length > 0) {
      await prisma.order_item.update({
        where: { id: row.order_item_id },
        data: {
          ...specUpdateData,
          ...(keptUntilData !== undefined ? { kept_until: keptUntilData } : {}),
        },
      });
    }
  }

  // Sync any newly added variants or sizes back to product detail (products table)
  if (productSpecsMap.size > 0) {
    const parseTagList = (raw?: string | null): string[] =>
      raw
        ? String(raw)
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    for (const [productId, spec] of productSpecsMap.entries()) {
      const existingProduct = await prisma.product.findUnique({
        where: { id: productId },
      });
      if (!existingProduct) continue;

      const existingVariants = parseTagList(existingProduct.variant);
      const existingSizes = parseTagList(existingProduct.size);

      const lowerExistingVars = new Set(existingVariants.map((v) => v.toLowerCase()));
      const lowerExistingSizes = new Set(existingSizes.map((s) => s.toLowerCase()));

      let hasChanges = false;
      for (const v of spec.variants) {
        if (!lowerExistingVars.has(v.toLowerCase())) {
          existingVariants.push(v);
          lowerExistingVars.add(v.toLowerCase());
          hasChanges = true;
        }
      }
      for (const s of spec.sizes) {
        if (!lowerExistingSizes.has(s.toLowerCase())) {
          existingSizes.push(s);
          lowerExistingSizes.add(s.toLowerCase());
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await prisma.product.update({
          where: { id: productId },
          data: {
            variant: existingVariants.length > 0 ? existingVariants.join(', ') : existingProduct.variant,
            size: existingSizes.length > 0 ? existingSizes.join(', ') : existingProduct.size,
          },
        });
      }
    }
  }

  return rows.length > 0 ? rows[0].id : null;
}

export async function syncNewProductSpecsHelper(
  prisma: PrismaService,
  newProductSpecs: any[] = []
) {
  if (!Array.isArray(newProductSpecs) || newProductSpecs.length === 0) return;

  const productSpecsMap = new Map<number, { variants: Set<string>; sizes: Set<string> }>();
  for (const sp of newProductSpecs) {
    const pid = Number(sp?.productId || sp?.product_id || 0);
    if (!pid) continue;
    if (!productSpecsMap.has(pid)) {
      productSpecsMap.set(pid, { variants: new Set(), sizes: new Set() });
    }
    const spec = productSpecsMap.get(pid)!;
    const v = String(sp?.variant || sp?.variation || '').trim();
    const s = String(sp?.size || '').trim();
    if (v && v !== '-' && v.toLowerCase() !== 'default') spec.variants.add(v);
    if (s && s !== '-') spec.sizes.add(s);
  }

  const parseTagList = (raw?: string | null): string[] =>
    raw
      ? String(raw)
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  for (const [productId, spec] of productSpecsMap.entries()) {
    const existingProduct = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!existingProduct) continue;

    const existingVariants = parseTagList(existingProduct.variant);
    const existingSizes = parseTagList(existingProduct.size);

    const lowerExistingVars = new Set(existingVariants.map((v) => v.toLowerCase()));
    const lowerExistingSizes = new Set(existingSizes.map((s) => s.toLowerCase()));

    let hasChanges = false;
    for (const v of spec.variants) {
      if (!lowerExistingVars.has(v.toLowerCase())) {
        existingVariants.push(v);
        lowerExistingVars.add(v.toLowerCase());
        hasChanges = true;
      }
    }
    for (const s of spec.sizes) {
      if (!lowerExistingSizes.has(s.toLowerCase())) {
        existingSizes.push(s);
        lowerExistingSizes.add(s.toLowerCase());
        hasChanges = true;
      }
    }

    if (hasChanges) {
      await prisma.product.update({
        where: { id: productId },
        data: {
          variant: existingVariants.length > 0 ? existingVariants.join(', ') : existingProduct.variant,
          size: existingSizes.length > 0 ? existingSizes.join(', ') : existingProduct.size,
        },
      });
    }
  }
}
