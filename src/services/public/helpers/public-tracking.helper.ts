import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { maskName, maskPhone, maskAddress } from './public-masking.helper';

export async function findPublicTargetOrder(prisma: PrismaService, clean: string) {
  // 1. Try finding by Invoice number
  let invoice = await prisma.invoice.findFirst({
    where: {
      invoice_number: { equals: clean, mode: 'insensitive' },
      deleted_at: null,
    },
    include: {
      customer: true,
      orders: {
        include: {
          order: {
            include: {
              period: true,
              items: { include: { product: true } },
              shipments: true,
            },
          },
        },
      },
      payments: true,
      refunds: {
        where: { deleted_at: null },
      },
    },
  });

  let targetOrder: any = null;
  if (invoice && invoice.orders.length > 0) {
    targetOrder = invoice.orders[0].order;
  }

  // 2. Try finding by Order number if not found yet
  if (!targetOrder) {
    targetOrder = await prisma.order.findFirst({
      where: {
        order_number: { equals: clean, mode: 'insensitive' },
        deleted_at: null,
      },
      include: {
        customer: true,
        period: true,
        items: { include: { product: true } },
        shipments: true,
        invoice_links: {
          include: {
            invoice: {
              include: {
                payments: true,
                refunds: { where: { deleted_at: null } },
              },
            },
          },
        },
      },
    });

    if (targetOrder?.invoice_links?.length > 0) {
      invoice = targetOrder.invoice_links[0].invoice;
    }
  }

  // 3. Try finding by Shipment tracking_number (Nomor Resi)
  if (!targetOrder) {
    const shipment = await prisma.shipment.findFirst({
      where: {
        tracking_number: { equals: clean, mode: 'insensitive' },
      },
      include: {
        order: {
          include: {
            customer: true,
            period: true,
            items: { include: { product: true } },
            shipments: true,
            invoice_links: {
              include: {
                invoice: {
                  include: {
                    payments: true,
                    refunds: { where: { deleted_at: null } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (shipment?.order) {
      targetOrder = shipment.order;
      if (targetOrder?.invoice_links?.length > 0) {
        invoice = targetOrder.invoice_links[0].invoice;
      }
    }
  }

  // 4. Try finding by customer code if provided (e.g. CUST-001)
  if (!targetOrder && clean.toUpperCase().startsWith('CUST')) {
    const customer = await prisma.customer.findFirst({
      where: {
        customer_code: { equals: clean, mode: 'insensitive' },
        deleted_at: null,
      },
      include: {
        orders: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
          take: 1,
          include: {
            customer: true,
            period: true,
            items: { include: { product: true } },
            shipments: true,
            invoice_links: {
              include: {
                invoice: {
                  include: { payments: true },
                },
              },
            },
          },
        },
      },
    });

    if (customer && customer.orders.length > 0) {
      targetOrder = customer.orders[0];
      if (targetOrder?.invoice_links?.length > 0) {
        invoice = targetOrder.invoice_links[0].invoice;
      }
    }
  }

  if (!targetOrder) {
    throw new NotFoundException(
      `Pesanan dengan nomor "${clean}" tidak ditemukan. Pastikan nomor Invoice (INV-...), nomor Order (ORD-...), atau nomor resi kurir sudah benar.`
    );
  }

  return { targetOrder, invoice };
}

export function buildTrackingTimelineResponse(targetOrder: any, invoice: any) {
  const customer = targetOrder.customer;
  const period = targetOrder.period;
  const latestShipment = targetOrder.shipments?.[0];

  const orderStatus = targetOrder.status;
  const shipmentStatus = latestShipment?.status;
  const invoiceStatus = invoice?.status;

  let currentStepIndex = 1;

  const isPaidOrPartial =
    invoiceStatus === 'PAID' ||
    invoiceStatus === 'PARTIAL' ||
    Number(targetOrder.paid_amount || 0) > 0;

  if (isPaidOrPartial) currentStepIndex = 2;

  if (orderStatus === 'PROCESSING' || orderStatus === 'SHOPPING') {
    currentStepIndex = 3;
  } else if (orderStatus === 'PURCHASED' || orderStatus === 'ARRIVED_HUB') {
    currentStepIndex = 4;
  } else if (orderStatus === 'READY_TO_SHIP' || shipmentStatus === 'PACKED' || shipmentStatus === 'READY') {
    currentStepIndex = 5;
  } else if (
    orderStatus === 'SHIPPED' ||
    shipmentStatus === 'HANDED_TO_COURIER' ||
    shipmentStatus === 'IN_TRANSIT'
  ) {
    currentStepIndex = 6;
  } else if (orderStatus === 'COMPLETED' || shipmentStatus === 'DELIVERED') {
    currentStepIndex = 7;
  }

  const timeline = [
    {
      step: 1,
      title: 'Pesanan Terdaftar',
      desc: 'Pesanan telah masuk ke sistem Worthtobuy & diverifikasi admin.',
      date: targetOrder.created_at,
      isCompleted: currentStepIndex >= 1,
      isCurrent: currentStepIndex === 1,
    },
    {
      step: 2,
      title: 'Pembayaran Terverifikasi',
      desc: isPaidOrPartial
        ? `Pembayaran telah kami terima (${invoice?.status === 'PAID' ? 'LUNAS' : 'DP Diterima'}).`
        : 'Menunggu konfirmasi pembayaran DP/Full.',
      date: invoice?.payments?.[0]?.payment_date || (isPaidOrPartial ? targetOrder.created_at : null),
      isCompleted: currentStepIndex >= 2,
      isCurrent: currentStepIndex === 2,
    },
    {
      step: 3,
      title: 'Hunting di Venue / Event',
      desc: `Shopper sedang mencarikan pesanan Anda di ${period?.name || 'event'}.`,
      date: period?.departure_at || null,
      isCompleted: currentStepIndex >= 3,
      isCurrent: currentStepIndex === 3,
    },
    {
      step: 4,
      title: 'Tiba di Hub Warehouse & QC',
      desc: 'Barang belanjaan tiba di HQ, pengecekan kondisi fisik & kelengkapan.',
      date: period?.return_at || null,
      isCompleted: currentStepIndex >= 4,
      isCurrent: currentStepIndex === 4,
    },
    {
      step: 5,
      title: 'Packing Aman & Siap Kirim',
      desc: 'Barang dibungkus bubble wrap tebal dan disiapkan label pengiriman.',
      date: latestShipment?.created_at || null,
      isCompleted: currentStepIndex >= 5,
      isCurrent: currentStepIndex === 5,
    },
    {
      step: 6,
      title: 'Dalam Pengiriman Kurir',
      desc: latestShipment?.tracking_number
        ? `Diserahkan ke kurir ${latestShipment.courier || ''} dengan No. Resi ${latestShipment.tracking_number}.`
        : 'Menunggu penyerahan paket ke kurir ekspedisi.',
      date: latestShipment?.shipped_at || null,
      isCompleted: currentStepIndex >= 6,
      isCurrent: currentStepIndex === 6,
    },
    {
      step: 7,
      title: 'Paket Diterima',
      desc: 'Pesanan telah sampai dengan selamat di tangan customer. Terima kasih!',
      date: currentStepIndex === 7 ? latestShipment?.updated_at || targetOrder.updated_at : null,
      isCompleted: currentStepIndex >= 7,
      isCurrent: currentStepIndex === 7,
    },
  ];

  const safeItems = (targetOrder.items || []).map((item: any) => ({
    id: item.id,
    name: item.product?.name || item.manual_product_name || 'Item Jastip',
    brand: item.brand_name || item.product?.brand_name || 'Official Brand',
    variation: item.variation || null,
    size: item.size || null,
    color: item.color || null,
    quantity: item.quantity,
    fulfillment_status: item.fulfillment_status,
    photo_url: item.photo_url || item.product?.image_url || null,
  }));

  return {
    order_number: targetOrder.order_number,
    order_date: targetOrder.order_date,
    status: targetOrder.status,
    customer: {
      maskedName: maskName(customer?.full_name || ''),
      maskedPhone: maskPhone(customer?.whatsapp || ''),
      destinationCity: maskAddress(customer?.address, customer?.city),
    },
    period: period
      ? {
          id: period.id,
          name: period.name,
          city: period.city,
          country: period.country,
          estimated_shipping_at: period.estimated_shipping_at,
        }
      : null,
    invoice: invoice
      ? {
          invoice_number: invoice.invoice_number,
          status: invoice.status,
          total_bill: invoice.total_bill,
          paid_amount: invoice.paid_amount,
          outstanding_amount: invoice.outstanding_amount,
          refunds: (invoice.refunds || []).map((r: any) => ({
            id: r.id,
            refund_number: r.refund_number,
            amount: r.amount,
            refund_type: r.refund_type,
            reason: r.reason,
            status: r.status,
            refunded_at: r.refunded_at,
            bank_name: r.bank_name,
            account_number: r.account_number,
            account_holder: r.account_holder,
            proof_url: r.proof_url,
            transfer_notes: r.transfer_notes,
            notes: r.notes,
          })),
        }
      : null,
    shipment: latestShipment
      ? {
          courier: latestShipment.courier,
          tracking_number: latestShipment.tracking_number,
          service_type: latestShipment.service_type,
          status: latestShipment.status,
          shipped_at: latestShipment.shipped_at,
        }
      : null,
    items: safeItems,
    timeline,
    currentStepIndex,
  };
}
