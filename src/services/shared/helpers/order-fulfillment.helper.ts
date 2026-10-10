import { PrismaService } from '../../../config/prisma/prisma.service';
import { sequence } from '../../../common/utils/http.utils';

export async function ensurePurchasesForOrderHelper(prisma: PrismaService, order_id: number) {
  const order = await prisma.order.findUnique({
    where: { id: order_id },
    include: {
      items: {
        include: {
          product: true,
          purchases: true,
        },
      },
    },
  });
  if (!order || !order.items || order.items.length === 0) return;

  for (const item of order.items) {
    // Ready stock items do not need to be purchased
    if (item.source_type === 'READY_STOCK' || item.product?.stock_mode === 'READY_STOCK') {
      if (item.fulfillment_status === 'PENDING') {
        await prisma.order_item.update({
          where: { id: item.id },
          data: { fulfillment_status: 'AVAILABLE', purchase_status: 'PURCHASED', status_updated_at: new Date() },
        });
      }
      continue;
    }

    if (item.purchases && item.purchases.length > 0) continue;

    const brand = item.brand_name || item.product?.brand_name || '-';
    const estimated = Number(item.target_price_idr || item.unit_price_foreign || 0);

    await prisma.purchase.create({
      data: {
        purchase_number: sequence('PUR'),
        purchase_date: new Date(),
        period_id: order.period_id,
        order_item_id: item.id,
        product_id: item.product_id || null,
        brand_name: brand,
        quantity: item.quantity,
        estimated_price: estimated,
        actual_price: estimated,
        price_difference: 0,
        status: 'WAITING_PURCHASE',
        currency_code: 'IDR',
        exchange_rate: 1,
        shopper_id: order.admin_id || null,
      },
    });

    if (item.purchase_status === 'PENDING') {
      await prisma.order_item.update({
        where: { id: item.id },
        data: { purchase_status: 'WAITING_PURCHASE' as any },
      });
    }
  }
}

export async function ensureShipmentForOrderHelper(prisma: PrismaService, order_id: number) {
  const order = await prisma.order.findUnique({
    where: { id: order_id },
    include: {
      customer: true,
      shipments: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });
  if (!order) return;

  if (order.shipments && order.shipments.length > 0) return;

  const address = order.customer?.address && order.customer?.address.trim() !== '-'
    ? order.customer.address.trim()
    : '-';

  const itemsSummary = order.items && order.items.length > 0
    ? order.items
        .map(
          (i) =>
            `${i.quantity}x ${i.product?.name || i.manual_product_name || 'Item'}${
              i.variation ? ` (${i.variation})` : ''
            }${i.size ? ` (${i.size})` : ''}${i.color ? ` [${i.color}]` : ''}`
        )
        .join(', ')
    : '';

  await prisma.shipment.create({
    data: {
      order_id: order.id,
      customer_id: order.customer_id,
      address,
      courier: 'JNE',
      service_type: null,
      tracking_number: null,
      shipping_cost: order.customer_shipping || 0,
      status: 'WAITING_PACKING',
      notes: itemsSummary ? `Item to pack: ${itemsSummary}` : `Pengiriman otomatis dibuat untuk pesanan ${order.order_number}.`,
    },
  });
}
