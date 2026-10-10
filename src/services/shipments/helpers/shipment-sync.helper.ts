import { BadRequestException } from '@nestjs/common';

export function isOrderFullyPaid(order: any): boolean {
  if (!order) return false;

  // 1. If invoice links exist, all invoices must be PAID or OVERPAID with 0 outstanding
  if (order.invoiceLinks && order.invoiceLinks.length > 0) {
    const hasUnpaidInvoice = order.invoiceLinks.some((link: any) => {
      const inv = link.invoice;
      if (!inv) return false;
      return !['PAID', 'OVERPAID'].includes(inv.status) || Number(inv.outstandingAmount || 0) > 0;
    });
    if (hasUnpaidInvoice) return false;
  }

  // 2. Outstanding amount check
  const outstanding = Number(order.outstandingAmount || 0);
  if (outstanding > 0) return false;

  // 3. Paid amount vs total bill check
  const totalBill = Number(order.totalBill || 0);
  const paidAmount = Number(order.paidAmount || 0);
  if (totalBill > 0 && paidAmount < totalBill) return false;

  // 4. Status check: order must not be in pending payment status
  if (['NEW', 'WAITING_DP', 'DP_RECEIVED', 'WAITING_SETTLEMENT'].includes(order.status)) {
    return false;
  }

  return true;
}

export function validateShipmentPaymentPreconditions(order: any, status: string, trackingNumber?: string) {
  if (order && !isOrderFullyPaid(order)) {
    if (['PACKED', 'READY'].includes(status)) {
      throw new BadRequestException('Pesanan belum lunas (Full Payment). Proses packing tidak dapat dilakukan sebelum pembayaran lunas.');
    }
    if (trackingNumber || ['IN_TRANSIT', 'HANDED_TO_COURIER', 'DELIVERED'].includes(status)) {
      throw new BadRequestException('Pesanan belum lunas (Full Payment). Nomor resi dan pengiriman tidak dapat diproses sebelum pembayaran lunas.');
    }
  }
}

export function validateShipmentTransition(targetStatus: string, current: any, body: any) {
  if (['IN_TRANSIT', 'HANDED_TO_COURIER', 'DELIVERED'].includes(targetStatus)) {
    const tracking = body.trackingNumber !== undefined ? body.trackingNumber : current.trackingNumber;
    if (!tracking || !String(tracking).trim()) {
      throw new BadRequestException('Nomor resi wajib diisi sebelum mengubah status pengiriman menjadi Sedang Dikirim / Selesai.');
    }
    const courier = body.courier !== undefined ? body.courier : current.courier;
    if (!courier || !String(courier).trim()) {
      throw new BadRequestException('Kurir pengiriman wajib diisi sebelum memproses pengiriman.');
    }
    const address = body.address !== undefined ? body.address : current.address;
    if (!address || !String(address).trim() || address === '-') {
      throw new BadRequestException('Alamat pengiriman belum lengkap. Mohon perbarui alamat sebelum memproses pengiriman.');
    }
    if (['IN_TRANSIT', 'HANDED_TO_COURIER'].includes(targetStatus) && !body.shippedAt && !current.shippedAt) {
      body.shippedAt = new Date();
    }
  }
}
