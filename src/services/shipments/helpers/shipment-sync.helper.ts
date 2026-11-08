import { BadRequestException } from '@nestjs/common';

export function isOrderFullyPaid(order: any): boolean {
  if (!order) return false;

  // 1. Order must not be in initial/unsettled item payment status
  if (['NEW', 'WAITING_DP', 'DP_RECEIVED', 'CANCELLED'].includes(order.status)) {
    return false;
  }

  const totalBill = Number(order.total_bill ?? order.totalBill ?? 0);
  const paidAmount = Number(order.paid_amount ?? order.paidAmount ?? 0);
  const outstanding = Number(order.outstanding_amount ?? order.outstandingAmount ?? 0);
  const customerShipping = Number(order.customer_shipping ?? order.customerShipping ?? 0);
  const nonShippingBill = Math.max(0, totalBill - customerShipping);

  // 2. If the order itself has 0 outstanding and its bill is covered, it is fully paid
  // (even if a sibling order on the same invoice has an ongkir settlement balance)
  if (outstanding <= 0 && (totalBill <= 0 || paidAmount >= totalBill)) {
    return true;
  }

  // 3. If the order is in shipment stage and its non-shipping (item + service fee) bill is fully paid,
  // any remaining outstanding amount is strictly shipping / ongkir settlement, which should not block
  // packing or inputting resi.
  if (
    ['READY_TO_SHIP', 'WAITING_SETTLEMENT', 'SHIPPED', 'COMPLETED'].includes(order.status) &&
    paidAmount > 0 &&
    paidAmount >= nonShippingBill
  ) {
    return true;
  }

  // 4. Fallback: if order.paid_amount was not synced yet, check if all linked invoices are PAID
  const invoiceLinks = order.invoice_links || order.invoiceLinks;
  if (invoiceLinks && invoiceLinks.length > 0) {
    const allInvoicesPaid = invoiceLinks.every((link: any) => {
      const inv = link.invoice;
      if (!inv) return false;
      const invOutstanding = Number(inv.outstanding_amount ?? inv.outstandingAmount ?? 0);
      return ['PAID', 'OVERPAID', 'REFUND_DUE'].includes(inv.status) && invOutstanding <= 0;
    });
    if (allInvoicesPaid) return true;
  }

  return false;
}

export function validateShipmentPaymentPreconditions(
  order: any,
  status: string,
  trackingNumber?: string
) {
  if (order && !isOrderFullyPaid(order)) {
    if (['PACKED', 'READY'].includes(status)) {
      throw new BadRequestException(
        'Pesanan belum lunas (Full Payment). ' +
          'Proses packing tidak dapat dilakukan sebelum pembayaran lunas.'
      );
    }
    if (trackingNumber || ['IN_TRANSIT', 'HANDED_TO_COURIER', 'DELIVERED'].includes(status)) {
      throw new BadRequestException(
        'Pesanan belum lunas (Full Payment). ' +
          'Nomor resi dan pengiriman tidak dapat diproses sebelum pembayaran lunas.'
      );
    }
  }
}

export function validateShipmentTransition(targetStatus: string, current: any, body: any) {
  const effectiveCourier = String(body.courier ?? current.courier ?? '');
  const isShopee =
    body.shipping_method === 'SHOPEE' ||
    body.shippingMethod === 'SHOPEE' ||
    (body.shipping_method === undefined &&
      body.shippingMethod === undefined &&
      current.shipping_method === 'SHOPEE') ||
    effectiveCourier.toLowerCase().includes('shopee');

  const isResiProvided =
    (body.tracking_number !== undefined &&
      body.tracking_number !== null &&
      String(body.tracking_number).trim() !== '') ||
    (body.trackingNumber !== undefined &&
      body.trackingNumber !== null &&
      String(body.trackingNumber).trim() !== '');

  if (current.status === 'WAITING_PACKING') {
    if (isResiProvided && !isShopee) {
      throw new BadRequestException(
        'Nomor resi tidak dapat diinput sebelum pesanan selesai dipacking ' +
          '(Status harus PACKED terlebih dahulu).'
      );
    }
    if (['IN_TRANSIT', 'HANDED_TO_COURIER'].includes(targetStatus)) {
      throw new BadRequestException(
        'Pesanan harus melalui proses packing terlebih dahulu sebelum dikirim.'
      );
    }
  }

  if (targetStatus === 'PACKED' && !isShopee) {
    const address = body.address ?? current.address;
    if (!address || !String(address).trim() || address === '-') {
      throw new BadRequestException(
        'Alamat pengiriman wajib diisi lengkap sebelum memproses packing.'
      );
    }
  }

  if (['IN_TRANSIT', 'HANDED_TO_COURIER', 'DELIVERED'].includes(targetStatus)) {
    const tracking =
      body.tracking_number ??
      body.trackingNumber ??
      current.tracking_number ??
      current.trackingNumber;
    if (!tracking || !String(tracking).trim()) {
      throw new BadRequestException(
        'Nomor resi wajib diisi sebelum mengubah status pengiriman menjadi ' +
          'Sedang Dikirim / Selesai.'
      );
    }
    const courier = body.courier ?? current.courier;
    if (!courier || !String(courier).trim()) {
      throw new BadRequestException('Kurir pengiriman wajib diisi sebelum memproses pengiriman.');
    }
    if (!isShopee) {
      const address = body.address ?? current.address;
      if (!address || !String(address).trim() || address === '-') {
        throw new BadRequestException(
          'Alamat pengiriman belum lengkap. Mohon perbarui alamat sebelum memproses pengiriman.'
        );
      }
    }
    const shippedAt =
      body.shipped_at ?? body.shippedAt ?? current.shipped_at ?? current.shippedAt;
    if (['IN_TRANSIT', 'HANDED_TO_COURIER'].includes(targetStatus) && !shippedAt) {
      body.shipped_at = new Date();
    }
  }
}
