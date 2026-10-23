import { PrismaService } from '../../../config/prisma/prisma.service';
import { RefundService } from '../../shared/refund.service';
import { ensureShipmentForOrderHelper } from '../../shared/helpers/order-fulfillment.helper';

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

    // Ensure shipment is created/bundled for fully paid order
    await ensureShipmentForOrderHelper(prisma, freshOrder.id);
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
