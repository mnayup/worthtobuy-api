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
          data: {
            fulfillment_status: 'AVAILABLE',
            purchase_status: 'PURCHASED',
            status_updated_at: new Date(),
          },
        });
      }
      continue;
    }

    if (item.purchases && item.purchases.length > 0) continue;

    const brand = item.brand_name || item.product?.brand_name || '-';
    const buyPrice = Number(item.product?.buy_price || 0);
    const unitCost = buyPrice > 0
      ? buyPrice
      : Number(item.target_price_idr || item.unit_price_foreign || 0);
    const estimated = unitCost * Number(item.quantity || 1);

    // Grouping: Check if another item in the same order already has a purchase
    let purchaseNumber: string | null = null;
    let batchNumber = 1;

    const orderExisting = await prisma.purchase.findFirst({
      where: { order_item: { order_id: order.id } },
      orderBy: { id: 'asc' },
    });

    if (orderExisting) {
      purchaseNumber = orderExisting.purchase_number;
      batchNumber = orderExisting.batch_number || 1;
    } else {
      // Check if same event & product & variant & size already has an active or previous purchase
      const productWhere: any = {
        period_id: order.period_id,
        order_item: {
          variation: item.variation ?? null,
          size: item.size ?? null,
          ...(item.product_id
            ? { product_id: item.product_id }
            : { manual_product_name: item.manual_product_name }),
        },
      };

      const existingForProduct = await prisma.purchase.findMany({
        where: productWhere,
        orderBy: [{ batch_number: 'desc' }, { id: 'desc' }],
      });

      if (existingForProduct.length > 0) {
        const latest = existingForProduct[0];
        if (latest.status === 'WAITING_PURCHASE') {
          purchaseNumber = latest.purchase_number;
          batchNumber = latest.batch_number || 1;
        } else {
          // If already purchased on this event, insert as Batch 2 (or next batch)
          batchNumber = (latest.batch_number || 1) + 1;
          const baseNum = latest.purchase_number.replace(/-B\d+$/, '');
          purchaseNumber = `${baseNum}-B${batchNumber}`;
        }
      }
    }

    if (!purchaseNumber) {
      purchaseNumber = sequence('PUR');
      batchNumber = 1;
    }

    await prisma.purchase.create({
      data: {
        purchase_number: purchaseNumber,
        batch_number: batchNumber,
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
      notes: itemsSummary
        ? `Item to pack: ${itemsSummary}`
        : `Pengiriman otomatis dibuat untuk pesanan ${order.order_number}.`,
    },
  });
}
