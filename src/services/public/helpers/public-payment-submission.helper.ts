import { sequence } from '../../../common/utils/http.utils';
import { PrismaService } from '../../../config/prisma/prisma.service';
import {
  ensurePurchasesForOrderHelper,
  ensureShipmentForOrderHelper,
} from '../../shared/helpers/order-fulfillment.helper';

export async function applyPublicShippingAndStoragePreferences(
  prisma: PrismaService,
  invoice: any,
  body: any
) {
  const orderIds = (invoice.orders || [])
    .map((link: any) => link.order_id || link.order?.id)
    .filter(Boolean);

  const rawKeep =
    body.keep_item !== undefined ? body.keep_item : body.keepItem;
  if (rawKeep !== undefined && orderIds.length > 0) {
    const isKeep = Boolean(rawKeep);
    const kept_until = isKeep
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      : null;
    await prisma.order_item.updateMany({
      where: { order_id: { in: orderIds } },
      data: { kept_until },
    });
    if (isKeep) {
      await prisma.order_item.updateMany({
        where: { order_id: { in: orderIds }, fulfillment_status: 'AVAILABLE' },
        data: { fulfillment_status: 'KEPT' },
      });
    } else {
      await prisma.order_item.updateMany({
        where: { order_id: { in: orderIds }, fulfillment_status: 'KEPT' },
        data: { fulfillment_status: 'AVAILABLE' },
      });
    }
  }

  const rawShippingMethod =
    body.shipping_method !== undefined ? body.shipping_method : body.shippingMethod;
  const rawShippingCourier =
    body.shipping_courier !== undefined ? body.shipping_courier : body.shippingCourier;
  const rawShippingService =
    body.shipping_service !== undefined ? body.shipping_service : body.shippingService;
  const rawShopeeUsername =
    body.shopee_username !== undefined ? body.shopee_username : body.shopeeUsername;
  const rawShopeeOrderNo =
    body.shopee_order_no !== undefined ? body.shopee_order_no : body.shopeeOrderNo;
  const rawShopeeVariant =
    body.shopee_variant !== undefined ? body.shopee_variant : body.shopeeVariant;

  const hasShippingUpdate =
    rawShippingMethod !== undefined ||
    rawShippingCourier !== undefined ||
    rawShippingService !== undefined ||
    rawShopeeOrderNo !== undefined ||
    rawShopeeVariant !== undefined;

  if (!hasShippingUpdate) {
    return {
      shipping_method: invoice.shipping_method || 'MANUAL',
      shipping_courier: invoice.shipping_courier || null,
      shipping_service: invoice.shipping_service || null,
      shopee_username: invoice.shopee_username || null,
      shopee_order_no: invoice.shopee_order_no || null,
      shopee_variant: invoice.shopee_variant || null,
    };
  }

  const shipping_method =
    String(rawShippingMethod ?? invoice.shipping_method ?? 'MANUAL').toUpperCase() === 'SHOPEE'
      ? 'SHOPEE'
      : 'MANUAL';

  const shipping_courier =
    shipping_method === 'MANUAL'
      ? (rawShippingCourier !== undefined
          ? String(rawShippingCourier || '').trim() || 'JNE'
          : invoice.shipping_courier || 'JNE')
      : null;

  const shipping_service =
    shipping_method === 'MANUAL'
      ? (rawShippingService !== undefined
          ? String(rawShippingService || '').trim() || null
          : invoice.shipping_service || null)
      : null;

  const shopee_username =
    shipping_method === 'SHOPEE'
      ? (rawShopeeUsername !== undefined
          ? String(rawShopeeUsername || '').trim() || null
          : invoice.shopee_username || null)
      : null;

  const shopee_order_no =
    shipping_method === 'SHOPEE'
      ? (rawShopeeOrderNo !== undefined
          ? String(rawShopeeOrderNo || '').trim() || null
          : invoice.shopee_order_no || null)
      : null;

  const shopee_variant =
    shipping_method === 'SHOPEE'
      ? (rawShopeeVariant !== undefined
          ? String(rawShopeeVariant || '').trim() || null
          : invoice.shopee_variant || null)
      : null;

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      shipping_method,
      shipping_courier,
      shipping_service,
      shopee_username,
      shopee_order_no,
      shopee_variant,
    },
  });

  if (orderIds.length > 0) {
    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: {
        shipping_method,
        shipping_courier,
        shipping_service,
        shopee_username,
        shopee_order_no,
        shopee_variant,
      },
    });

    const targetShipments = await prisma.shipment.findMany({
      where: {
        status: { in: ['WAITING_VERIFICATION', 'WAITING_PACKING'] as any },
        packed_at: null,
        OR: [
          { order_id: { in: orderIds } },
          { shipment_orders: { some: { order_id: { in: orderIds } } } },
        ],
      },
      orderBy: { id: 'asc' },
    });

    if (targetShipments.length > 0) {
      if (shipping_method === 'SHOPEE') {
        let canSetTrackingOnFirst = false;
        if (shopee_order_no) {
          const conflict = await prisma.shipment.findFirst({
            where: {
              tracking_number: shopee_order_no,
              id: { not: targetShipments[0].id },
            },
          });
          canSetTrackingOnFirst = !conflict;
        }

        for (let i = 0; i < targetShipments.length; i++) {
          const sh = targetShipments[i];
          await prisma.shipment.update({
            where: { id: sh.id },
            data: {
              courier: 'Shopee (Checkout Shopee)',
              service_type: 'Checkout Shopee',
              shipping_method: 'SHOPEE',
              shopee_username,
              shopee_order_no,
              shopee_variant,
              ...(i === 0 && canSetTrackingOnFirst && shopee_order_no
                ? { tracking_number: shopee_order_no }
                : {}),
            },
          });
        }
      } else {
        let matchedCounterId: number | null = null;
        if (shipping_courier) {
          const counter = await prisma.shipping_counter.findFirst({
            where: {
              deleted_at: null,
              is_active: true,
              name: { equals: shipping_courier, mode: 'insensitive' },
            },
          });
          if (counter) matchedCounterId = counter.id;
        }

        for (const sh of targetShipments) {
          await prisma.shipment.update({
            where: { id: sh.id },
            data: {
              courier: shipping_courier || 'JNE',
              service_type: shipping_service || 'Regular (REG)',
              shipping_counter_id: matchedCounterId,
              shipping_method: 'MANUAL',
              shopee_username: null,
              shopee_order_no: null,
              shopee_variant: null,
              ...(sh.shipping_method === 'SHOPEE' ? { tracking_number: null } : {}),
            },
          });
        }
      }
    }
  }

  return {
    shipping_method,
    shipping_courier,
    shipping_service,
    shopee_username,
    shopee_order_no,
    shopee_variant,
  };
}

export async function insertPaymentRecord(
  prisma: PrismaService,
  invoice: any,
  body: any,
  method: string,
  amount: number,
  proof_url: string
) {
  const destination_account = body.destination_account
    ? String(body.destination_account).trim()
    : null;
  const payment_date = body.payment_date
    ? new Date(body.payment_date)
    : new Date();
  const notes = body.notes ? String(body.notes).trim() : null;

  const payment = await prisma.payment.create({
    data: {
      invoice_id: invoice.id,
      payment_number: sequence('PAY'),
      amount,
      method,
      destination_account,
      proof_url,
      payment_date,
      notes,
      status: 'PENDING',
      verified_by_id: null,
    },
  });

  await applyPublicShippingAndStoragePreferences(prisma, invoice, body);

  // Check if customer has now uploaded full payment (verified + deposit + pending >= total_bill).
  // If so, directly insert order(s) into shipment with status WAITING_VERIFICATION without waiting for verification first.
  const orderIds = (invoice.orders || [])
    .map((link: any) => link.order_id || link.order?.id)
    .filter(Boolean);

  if (orderIds.length > 0) {
    const [freshInvoice, allActivePayments] = await Promise.all([
      prisma.invoice.findUnique({
        where: { id: invoice.id },
        include: {
          orders: {
            include: {
              order: {
                include: { items: true },
              },
            },
          },
        },
      }),
      prisma.payment.findMany({
        where: {
          deleted_at: null,
          status: { in: ['VERIFIED', 'PENDING'] },
          OR: [{ invoice_id: invoice.id }, { order_id: { in: orderIds } }],
        },
        select: { amount: true, status: true },
      }),
    ]);

    if (freshInvoice) {
      const isOrderUnavailable = (ord: any) =>
        !ord ||
        ord.status === 'UNAVAILABLE' ||
        (Array.isArray(ord.items) &&
          ord.items.length > 0 &&
          ord.items.every((it: any) => it.fulfillment_status === 'UNAVAILABLE'));

      const billableTotal =
        freshInvoice.orders.length > 0
          ? freshInvoice.orders.reduce((sum, link) => {
              if (isOrderUnavailable(link.order)) return sum;
              return sum + Number(link.order?.total_bill ?? link.snapshot_amount ?? 0);
            }, 0)
          : Number(freshInvoice.total_bill || 0);

      const depositAmount = Number(freshInvoice.deposit_amount || 0);
      const totalUploadedAndVerified =
        depositAmount +
        allActivePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      if (billableTotal > 0 && totalUploadedAndVerified >= billableTotal) {
        for (const link of freshInvoice.orders) {
          if (isOrderUnavailable(link.order)) continue;
          await ensurePurchasesForOrderHelper(prisma, link.order_id);
          await ensureShipmentForOrderHelper(prisma, link.order_id);
        }
        await applyPublicShippingAndStoragePreferences(prisma, freshInvoice, body);
      }
    }
  }

  const customerName = invoice.customer?.full_name || 'Pelanggan';
  const notifMsg =
    `${invoice.invoice_number} • ${customerName} mengunggah bukti ` +
    `transfer ${method} Rp ${amount.toLocaleString('id-ID')}`;
  await prisma.notification.create({
    data: {
      type: 'PAYMENT',
      title: 'Bukti transfer baru diunggah pelanggan',
      message: notifMsg,
      link: `/invoices/${invoice.id}`,
    },
  });

  return payment;
}
