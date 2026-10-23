import { sequence } from '../../../common/utils/http.utils';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

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

  const rawKeep =
    body.keep_item !== undefined ? body.keep_item : body.keepItem;
  if (rawKeep !== undefined) {
    const isKeep = Boolean(rawKeep);
    const orderIds = (invoice.orders || []).map((link: any) => link.order_id);
    if (orderIds.length > 0) {
      const kept_until = isKeep
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        : null;
      await prisma.order_item.updateMany({
        where: { order_id: { in: orderIds } },
        data: { kept_until },
      });
    }
  }

  const rawShippingMethod =
    body.shipping_method !== undefined ? body.shipping_method : body.shippingMethod;
  const rawShopeeUsername =
    body.shopee_username !== undefined ? body.shopee_username : body.shopeeUsername;

  if (rawShippingMethod !== undefined) {
    const shipping_method =
      String(rawShippingMethod).toUpperCase() === 'SHOPEE' ? 'SHOPEE' : 'MANUAL';
    const shopee_username = rawShopeeUsername ? String(rawShopeeUsername).trim() : null;

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        shipping_method,
        shopee_username,
      },
    });

    const orderIds = (invoice.orders || []).map((link: any) => link.order_id);
    if (orderIds.length > 0) {
      await prisma.order.updateMany({
        where: { id: { in: orderIds } },
        data: {
          shipping_method,
          shopee_username,
        },
      });

      if (shipping_method === 'SHOPEE') {
        await prisma.shipment.updateMany({
          where: { order_id: { in: orderIds }, status: 'WAITING_PACKING' },
          data: {
            courier: 'Shopee',
            service_type: 'Checkout Shopee',
            shipping_method: 'SHOPEE',
            shopee_username,
          },
        });
      } else {
        await prisma.shipment.updateMany({
          where: {
            order_id: { in: orderIds },
            status: 'WAITING_PACKING',
            courier: 'Shopee',
          },
          data: {
            courier: 'JNE',
            service_type: null,
            shipping_method: 'MANUAL',
            shopee_username: null,
          },
        });
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
