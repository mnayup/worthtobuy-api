import { PrismaService } from '../../../config/prisma/prisma.service';
import { RefundService } from '../../shared/refund.service';
import {
  handlePurchasedTransitionHelper,
  handleUnavailableTransitionHelper,
} from './purchase-transitions.helper';

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
  userId?: number
) {
  const rows = await prisma.purchase.findMany({
    where: { purchase_number: purchaseNumber },
    include: {
      order_item: {
        include: { order: { include: { customer: true } } },
      },
    },
  });

  const commonData: any = {};
  if (body.paymentMethod !== undefined) commonData.payment_method = body.paymentMethod;
  if (body.receiptUrl !== undefined) commonData.receipt_url = body.receiptUrl;
  if (body.notes !== undefined) commonData.notes = body.notes;
  if (body.shopperId !== undefined) commonData.shopper_id = Number(body.shopperId) || null;

  const itemMap = new Map<number, any>();
  (body.items || []).forEach((it: any) => {
    if (it.order_item_id) itemMap.set(Number(it.order_item_id), it);
    if (it.id) itemMap.set(Number(it.id), it);
  });

  for (const row of rows) {
    const itInput = itemMap.get(row.order_item_id) || itemMap.get(row.id);
    const isRejected = Boolean(itInput?.is_rejected || itInput?.status === 'UNAVAILABLE');
    const isBought = Boolean(itInput?.is_bought ?? !isRejected);
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

    const order = row.order_item.order;
    const fromStatus = row.order_item.fulfillment_status;

    // Case 1: Completely Rejected / 0 allocated
    if (isRejected || allocatedQty <= 0) {
      await prisma.purchase.update({
        where: { id: row.id },
        data: {
          ...commonData,
          status: 'UNAVAILABLE',
          actual_price: 0,
          price_difference: 0,
        },
      });

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
      const shortageQty = row.quantity - allocatedQty;
      const boughtActual = unitPrice * allocatedQty;
      const boughtEst = (Number(row.estimated_price) * allocatedQty) / row.quantity;

      // Update primary purchase and order_item for the bought quantity
      await prisma.purchase.update({
        where: { id: row.id },
        data: {
          ...commonData,
          quantity: allocatedQty,
          status: 'PURCHASED',
          actual_price: boughtActual,
          estimated_price: boughtEst,
          price_difference: boughtActual - boughtEst,
        },
      });

      await prisma.order_item.update({
        where: { id: row.order_item_id },
        data: { quantity: allocatedQty },
      });

      await handlePurchasedTransitionHelper(
        prisma,
        order,
        row.order_item_id,
        fromStatus,
        userId
      );

      // Create new order_item & purchase for the shortage/rejected portion
      const rejectedItem = await prisma.order_item.create({
        data: {
          order_id: order.id,
          product_id: row.order_item.product_id,
          manual_product_name: row.order_item.manual_product_name,
          brand_name: row.order_item.brand_name,
          variation: row.order_item.variation,
          size: row.order_item.size,
          color: row.order_item.color,
          quantity: shortageQty,
          unit_price_foreign: row.order_item.unit_price_foreign,
          target_price_idr: row.order_item.target_price_idr,
          fulfillment_status: 'UNAVAILABLE',
          purchase_status: 'UNAVAILABLE',
        },
      });

      await prisma.purchase.create({
        data: {
          purchase_number: row.purchase_number,
          batch_number: row.batch_number || 1,
          purchase_date: row.purchase_date,
          period_id: row.period_id,
          order_item_id: rejectedItem.id,
          product_id: row.product_id,
          brand_name: row.brand_name,
          quantity: shortageQty,
          estimated_price: (Number(row.estimated_price) * shortageQty) / row.quantity,
          actual_price: 0,
          price_difference: 0,
          status: 'UNAVAILABLE',
          currency_code: 'IDR',
          exchange_rate: 1,
          shopper_id: row.shopper_id,
        },
      });

      await handleUnavailableTransitionHelper(
        prisma,
        refundService,
        order,
        rejectedItem.id,
        'PENDING',
        userId
      );
      continue;
    }

    // Case 3: Fully bought or waiting purchase
    const rowStatus = isBought ? 'PURCHASED' : 'WAITING_PURCHASE';
    const rowActual = unitPrice * row.quantity;
    const est = Number(row.estimated_price);

    await prisma.purchase.update({
      where: { id: row.id },
      data: {
        ...commonData,
        status: rowStatus as any,
        actual_price: rowActual,
        price_difference: rowActual - est,
      },
    });

    if (rowStatus === 'PURCHASED') {
      await handlePurchasedTransitionHelper(
        prisma,
        order,
        row.order_item_id,
        fromStatus,
        userId
      );
    }
  }

  return rows.length > 0 ? rows[0].id : null;
}
