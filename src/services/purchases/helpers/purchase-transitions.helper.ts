import { PrismaService } from '../../../config/prisma/prisma.service';
import { RefundService } from '../../shared/refund.service';

export async function handlePurchasedTransitionHelper(
  prisma: PrismaService,
  order: any,
  order_item_id: number,
  from_status: any,
  user_id?: number
) {
  const currentItem = await prisma.order_item.findUnique({
    where: { id: order_item_id },
    select: { kept_until: true },
  });
  const isKept = Boolean(currentItem?.kept_until);
  const targetFulfillmentStatus = isKept ? 'KEPT' : 'AVAILABLE';

  await prisma.order_item.update({
    where: { id: order_item_id },
    data: {
      purchase_status: 'PURCHASED',
      fulfillment_status: targetFulfillmentStatus as any,
      status_updated_at: new Date(),
    },
  });

  await prisma.item_status_history.create({
    data: {
      order_item_id,
      from_status,
      to_status: targetFulfillmentStatus as any,
      notes: isKept
        ? 'Status pembelian diubah menjadi Sudah Dibeli & Dititip Simpan (KEPT).'
        : 'Status pembelian diubah menjadi Sudah Dibeli (PURCHASED).',
      user_id,
    },
  });

  const pendingItems = await prisma.order_item.count({
    where: {
      order_id: order.id,
      fulfillment_status: {
        notIn: ['AVAILABLE', 'KEPT', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'UNAVAILABLE'],
      },
    },
  });

  if (pendingItems === 0) {
    const freshOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { customer: true, shipments: true, items: true },
    });

    const activeItems = (freshOrder.items || []).filter(
      (i) => i.fulfillment_status !== 'UNAVAILABLE'
    );
    const allKept =
      activeItems.length > 0 &&
      activeItems.every((i) => i.fulfillment_status === 'KEPT');

    const isPartial = Number(freshOrder.outstanding_amount) > 0;
    if (isPartial) {
      await prisma.order.update({
        where: { id: freshOrder.id },
        data: { status: 'WAITING_SETTLEMENT' },
      });
    } else if (!allKept) {
      await prisma.order.update({
        where: { id: freshOrder.id },
        data: { status: 'READY_TO_SHIP' },
      });
    }

    // Only create shipment if order is fully paid and not all kept
    if (!isPartial && !allKept && (!freshOrder.shipments || freshOrder.shipments.length === 0)) {
      const orderWithItems = await prisma.order.findUnique({
        where: { id: freshOrder.id },
        include: { items: { include: { product: true } } },
      });
      const itemsSummary = (orderWithItems?.items || [])
        .map((i) => {
          const name = i.product?.name || i.manual_product_name || 'Item';
          const v = i.variation ? ` (${i.variation})` : '';
          const s = i.size ? ` (${i.size})` : '';
          const c = i.color ? ` [${i.color}]` : '';
          return `${i.quantity}x ${name}${v}${s}${c}`;
        })
        .join(', ');

      const rawAddr = freshOrder.customer?.address;
      const address = rawAddr && rawAddr.trim() !== '-' ? rawAddr.trim() : '-';

      await prisma.shipment.create({
        data: {
          order_id: freshOrder.id,
          customer_id: freshOrder.customer_id,
          address,
          courier: 'JNE',
          service_type: null,
          tracking_number: null,
          shipping_cost: freshOrder.customer_shipping || 0,
          status: 'WAITING_PACKING',
          notes: itemsSummary
            ? `Item to pack: ${itemsSummary}`
            : `Pengiriman dibuat otomatis untuk pesanan ${freshOrder.order_number}.`,
        },
      });
    }
  }
}

export async function handleUnavailableTransitionHelper(
  prisma: PrismaService,
  refundService: RefundService,
  order: any,
  order_item_id: number,
  from_status: any,
  user_id?: number
) {
  await prisma.order_item.update({
    where: { id: order_item_id },
    data: {
      purchase_status: 'UNAVAILABLE',
      fulfillment_status: 'UNAVAILABLE',
      status_updated_at: new Date(),
    },
  });

  await prisma.item_status_history.create({
    data: {
      order_item_id,
      from_status,
      to_status: 'UNAVAILABLE',
      notes: 'Status pembelian diubah menjadi Tidak Tersedia (UNAVAILABLE).',
      user_id,
    },
  });

  await refundService.ensureUnavailableItemRefund(order_item_id);

  const totalItems = await prisma.order_item.count({ where: { order_id: order.id } });
  const unavailableCount = await prisma.order_item.count({
    where: { order_id: order.id, fulfillment_status: 'UNAVAILABLE' },
  });

  if (totalItems > 0 && totalItems === unavailableCount) {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'UNAVAILABLE' },
    });
  }
}
