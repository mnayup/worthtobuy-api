import { BadRequestException } from '@nestjs/common';

export function isOrderFullyPaid(order: any): boolean {
  if (!order) return false;

  if (['CANCELLED'].includes(order.status)) {
    return false;
  }

  // 1. If the order is linked to any active invoice, every active linked invoice MUST be verified full payment
  const invoiceLinks = order.invoice_links || order.invoiceLinks;
  if (Array.isArray(invoiceLinks) && invoiceLinks.length > 0) {
    const activeInvoices = invoiceLinks
      .map((link: any) => link?.invoice)
      .filter((inv: any) => inv && !inv.deleted_at && inv.status !== 'CANCELLED');

    if (activeInvoices.length > 0) {
      const allInvoicesPaid = activeInvoices.every((inv: any) => {
        const invOutstanding = Number(inv.outstanding_amount ?? inv.outstandingAmount ?? 0);
        const invTotal = Number(inv.total_bill ?? inv.totalBill ?? 0);
        const invPaid =
          Number(inv.paid_amount ?? inv.paidAmount ?? 0) +
          Number(inv.deposit_amount ?? inv.depositAmount ?? 0);
        return (
          ['PAID', 'OVERPAID', 'REFUND_DUE'].includes(inv.status) &&
          invOutstanding <= 0 &&
          (invTotal <= 0 || invPaid >= invTotal)
        );
      });
      return allInvoicesPaid;
    }
  }

  // 2. Standalone order (not linked to an active invoice)
  if (['NEW', 'WAITING_DP', 'DP_RECEIVED'].includes(order.status)) {
    return false;
  }

  const totalBill = Number(order.total_bill ?? order.totalBill ?? 0);
  const paidAmount = Number(order.paid_amount ?? order.paidAmount ?? 0);
  const outstanding = Number(order.outstanding_amount ?? order.outstandingAmount ?? 0);

  if (outstanding <= 0 && (totalBill <= 0 || paidAmount >= totalBill)) {
    return true;
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
        'Pesanan belum lunas (Full Payment) atau pembayaran belum diverifikasi. ' +
          'Proses packing tidak dapat dilakukan sebelum pembayaran lunas dan terverifikasi.'
      );
    }
    if (trackingNumber || ['IN_TRANSIT', 'HANDED_TO_COURIER', 'DELIVERED'].includes(status)) {
      throw new BadRequestException(
        'Pesanan belum lunas (Full Payment) atau pembayaran belum diverifikasi. ' +
          'Nomor resi dan pengiriman tidak dapat diproses sebelum pembayaran lunas dan terverifikasi.'
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

  if (current.status === 'WAITING_VERIFICATION') {
    if (['PACKED', 'READY', 'IN_TRANSIT', 'HANDED_TO_COURIER', 'DELIVERED'].includes(targetStatus)) {
      throw new BadRequestException(
        'Pembayaran penuh (Full Payment) pada pengiriman ini belum diverifikasi. ' +
          'Silakan verifikasi pembayaran terlebih dahulu sebelum melanjutkan ke proses packing.'
      );
    }
    if (isResiProvided && !isShopee) {
      throw new BadRequestException(
        'Nomor resi tidak dapat diinput sebelum pembayaran diverifikasi dan pesanan selesai dipacking.'
      );
    }
  }

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
