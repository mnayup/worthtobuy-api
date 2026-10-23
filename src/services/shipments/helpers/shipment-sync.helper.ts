import { BadRequestException } from '@nestjs/common';

export function isOrderFullyPaid(order: any): boolean {
  if (!order) return false;

  // 1. If invoice links exist, all invoices must be PAID, OVERPAID, or REFUND_DUE with 0 outstanding
  const invoiceLinks = order.invoice_links || order.invoiceLinks;
  if (invoiceLinks && invoiceLinks.length > 0) {
    const hasUnpaidInvoice = invoiceLinks.some((link: any) => {
      const inv = link.invoice;
      if (!inv) return false;
      const outstanding = Number(inv.outstanding_amount ?? inv.outstandingAmount ?? 0);
      return !['PAID', 'OVERPAID', 'REFUND_DUE'].includes(inv.status) || outstanding > 0;
    });
    if (hasUnpaidInvoice) return false;
  }

  // 2. Outstanding amount check
  const outstanding = Number(order.outstanding_amount ?? order.outstandingAmount ?? 0);
  if (outstanding > 0) return false;

  // 3. Paid amount vs total bill check
  const totalBill = Number(order.total_bill ?? order.totalBill ?? 0);
  const paidAmount = Number(order.paid_amount ?? order.paidAmount ?? 0);
  if (totalBill > 0 && paidAmount < totalBill) return false;

  // 4. Status check: order must not be in pending payment status
  if (['NEW', 'WAITING_DP', 'DP_RECEIVED', 'WAITING_SETTLEMENT'].includes(order.status)) {
    return false;
  }

  return true;
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
  const isResiProvided =
    (body.tracking_number !== undefined &&
      body.tracking_number !== null &&
      String(body.tracking_number).trim() !== '') ||
    (body.trackingNumber !== undefined &&
      body.trackingNumber !== null &&
      String(body.trackingNumber).trim() !== '');

  if (current.status === 'WAITING_PACKING') {
    if (isResiProvided) {
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

  if (targetStatus === 'PACKED') {
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
    const address = body.address ?? current.address;
    if (!address || !String(address).trim() || address === '-') {
      throw new BadRequestException(
        'Alamat pengiriman belum lengkap. Mohon perbarui alamat sebelum memproses pengiriman.'
      );
    }
    const shippedAt =
      body.shipped_at ?? body.shippedAt ?? current.shipped_at ?? current.shippedAt;
    if (['IN_TRANSIT', 'HANDED_TO_COURIER'].includes(targetStatus) && !shippedAt) {
      body.shipped_at = new Date();
    }
  }
}
