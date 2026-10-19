import { maskName, maskPhone, maskAddress } from './public-masking.helper';
export { findPublicTargetOrder } from './public-tracking-lookup.helper';

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
  } else if (
    orderStatus === 'READY_TO_SHIP' ||
    shipmentStatus === 'PACKED' ||
    shipmentStatus === 'READY'
  ) {
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

  const isPacked =
    Boolean(latestShipment?.packed_at) ||
    ['PACKED', 'READY', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'DELIVERED']
      .includes(shipmentStatus) ||
    orderStatus === 'READY_TO_SHIP';

  const isShipped =
    Boolean(latestShipment?.shipped_at) ||
    ['HANDED_TO_COURIER', 'IN_TRANSIT', 'DELIVERED'].includes(shipmentStatus) ||
    ['SHIPPED', 'COMPLETED'].includes(orderStatus);

  const isDelivered =
    shipmentStatus === 'DELIVERED' || orderStatus === 'COMPLETED';

  const packingDate =
    latestShipment?.packed_at ||
    (isPacked
      ? latestShipment?.updated_at || latestShipment?.created_at
      : null);

  const shippingDate =
    latestShipment?.shipped_at ||
    (isShipped ? latestShipment?.updated_at : null);

  const paymentDate =
    invoice?.payments?.[0]?.payment_date ||
    invoice?.payments?.[0]?.created_at ||
    (isPaidOrPartial ? invoice?.updated_at || targetOrder.created_at : null);

  const deliveredDate = isDelivered
    ? latestShipment?.updated_at || targetOrder.updated_at
    : null;

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
        ? `Pembayaran telah kami terima (` +
          `${invoice?.status === 'PAID' ? 'LUNAS' : 'DP Diterima'}).`
        : 'Menunggu konfirmasi pembayaran DP/Full.',
      date: isPaidOrPartial ? paymentDate : null,
      isCompleted: currentStepIndex >= 2,
      isCurrent: currentStepIndex === 2,
    },
    {
      step: 3,
      title: 'Hunting di Venue / Event',
      desc: `Shopper sedang mencarikan pesanan Anda di ` +
        `${period?.name || 'event'}.`,
      date: currentStepIndex >= 3 ? period?.departure_at || null : null,
      isCompleted: currentStepIndex >= 3,
      isCurrent: currentStepIndex === 3,
    },
    {
      step: 4,
      title: 'Tiba di Hub Warehouse & QC',
      desc: 'Barang belanjaan tiba di HQ, pengecekan kondisi fisik ' +
        '& kelengkapan.',
      date: currentStepIndex >= 4 ? period?.return_at || null : null,
      isCompleted: currentStepIndex >= 4,
      isCurrent: currentStepIndex === 4,
    },
    {
      step: 5,
      title: 'Packing Aman & Siap Kirim',
      desc: 'Barang dibungkus bubble wrap tebal dan disiapkan label pengiriman.',
      date: currentStepIndex >= 5 ? packingDate : null,
      isCompleted: currentStepIndex >= 5,
      isCurrent: currentStepIndex === 5,
    },
    {
      step: 6,
      title: 'Dalam Pengiriman Kurir',
      desc: latestShipment?.tracking_number
        ? `Diserahkan ke kurir ${latestShipment.courier || ''} dengan ` +
          `No. Resi ${latestShipment.tracking_number}.`
        : 'Menunggu penyerahan paket ke kurir ekspedisi.',
      date: currentStepIndex >= 6 ? shippingDate : null,
      isCompleted: currentStepIndex >= 6,
      isCurrent: currentStepIndex === 6,
    },
    {
      step: 7,
      title: 'Paket Diterima',
      desc: 'Pesanan telah sampai dengan selamat di tangan customer. ' +
        'Terima kasih!',
      date: currentStepIndex >= 7 ? deliveredDate : null,
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
