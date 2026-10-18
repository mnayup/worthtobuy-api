import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { sequence } from '../../common/utils/http.utils';

@Injectable()
export class RefundService {
  constructor(private prisma: PrismaService) { }

  async ensureOverpaymentRefund(invoice_id: number, amount: number) {
    const source_key = `INVOICE-${invoice_id}-OVERPAYMENT`;
    const existing = await this.prisma.refund.findUnique({ where: { source_key } });
    if (amount <= 0) {
      if (!existing || existing.status === 'PAID' || existing.status === 'REJECTED') return existing;
      if (existing.status === 'REQUESTED') return this.prisma.refund.delete({ where: { id: existing.id } });
      return this.prisma.refund.update({
        where: { id: existing.id },
        data: { status: 'REJECTED', notes: 'Dibatalkan otomatis karena tidak ada lagi kelebihan pembayaran.' },
      });
    }
    if (existing?.status === 'PAID') {
      await this.prisma.refund.update({ where: { id: existing.id }, data: { source_key: null } });
    } else if (existing) {
      return this.prisma.refund.update({
        where: { id: existing.id },
        data: {
          amount,
          reason: 'Kelebihan pembayaran terdeteksi otomatis.',
          invoice_id,
        },
      });
    }
    return this.prisma.refund.upsert({
      where: { source_key },
      update: {
        amount,
        reason: 'Kelebihan pembayaran terdeteksi otomatis.',
        invoice_id,
        source: 'OVERPAYMENT',
      },
      create: {
        refund_number: sequence('REF-AUTO'),
        invoice_id,
        amount,
        reason: 'Kelebihan pembayaran terdeteksi otomatis.',
        source: 'OVERPAYMENT',
        source_key,
        auto_generated: true,
        status: 'REQUESTED',
      },
    });
  }

  async removeUnavailableItemRefund(order_item_id: number) {
    const source_key = `ITEM-${order_item_id}-UNAVAILABLE`;
    const existing = await this.prisma.refund.findUnique({ where: { source_key } });
    if (!existing) return null;
    if (existing.status === 'PAID') return existing;
    return this.prisma.refund.update({
      where: { id: existing.id },
      data: { status: 'REJECTED', notes: 'Dibatalkan otomatis karena barang kembali tersedia.' },
    });
  }

  async ensureUnavailableItemRefund(order_item_id: number) {
    const item = await this.prisma.order_item.findUniqueOrThrow({
      where: { id: order_item_id },
      include: {
        order: { include: { invoice_links: { include: { invoice: true } }, refunds: true } },
        product: true,
      },
    });
    const source_key = `ITEM-${order_item_id}-UNAVAILABLE`;
    const itemAmount = Number(item.unit_price_foreign) * item.quantity;
    const otherActiveRefunds = item.order.refunds
      .filter(refund => refund.source === 'UNAVAILABLE_ITEM' && refund.source_key !== source_key && refund.status !== 'REJECTED')
      .reduce((sum, refund) => sum + Number(refund.amount), 0);
    const paidAvailable = Math.max(0, Number(item.order.paid_amount) - otherActiveRefunds);
    const amount = Math.min(itemAmount, paidAvailable);
    const existing = await this.prisma.refund.findUnique({ where: { source_key } });
    if (amount <= 0) {
      if (!existing || existing.status === 'PAID' || existing.status === 'REJECTED') return existing;
      if (existing.status === 'REQUESTED') return this.prisma.refund.delete({ where: { id: existing.id } });
      return this.prisma.refund.update({
        where: { id: existing.id },
        data: { status: 'REJECTED', notes: 'Dibatalkan otomatis karena belum ada pembayaran yang perlu dikembalikan.' },
      });
    }
    if (existing?.status === 'PAID') return existing;
    const invoice_id = item.order.invoice_links[0]?.invoice_id;
    const label = item.product?.name || item.manual_product_name || `Item #${item.id}`;
    if (existing) {
      return this.prisma.refund.update({
        where: { id: existing.id },
        data: {
          amount,
          order_id: item.order_id,
          invoice_id,
          reason: `Barang tidak dapat: ${label}.`,
        },
      });
    }
    const refund = await this.prisma.refund.upsert({
      where: { source_key },
      update: {
        amount,
        order_id: item.order_id,
        invoice_id,
        reason: `Barang tidak dapat: ${label}.`,
        source: 'UNAVAILABLE_ITEM',
      },
      create: {
        refund_number: sequence('REF-AUTO'),
        order_id: item.order_id,
        invoice_id,
        amount,
        reason: `Barang tidak dapat: ${label}.`,
        source: 'UNAVAILABLE_ITEM',
        source_key,
        auto_generated: true,
        status: 'REQUESTED',
      },
    });
    if (invoice_id) {
      await this.prisma.invoice.update({ where: { id: invoice_id }, data: { status: 'REFUND_DUE' } });
    }
    return refund;
  }

  async ensureShippingRefund(shipment_id: number, order_id: number, amount: number) {
    const source_key = `SHIPMENT-${shipment_id}-OVERPAYMENT`;
    const existing = await this.prisma.refund.findUnique({ where: { source_key } });
    if (amount <= 0) {
      if (!existing || existing.status === 'PAID' || existing.status === 'REJECTED') {
        return existing;
      }
      if (existing.status === 'REQUESTED') {
        return this.prisma.refund.delete({ where: { id: existing.id } });
      }
      return this.prisma.refund.update({
        where: { id: existing.id },
        data: {
          status: 'REJECTED',
          notes: 'Dibatalkan otomatis karena tidak ada kelebihan ongkir.',
        },
      });
    }
    const order = await this.prisma.order.findUnique({
      where: { id: order_id },
      include: { invoice_links: true },
    });
    const invoice_id = order?.invoice_links?.[0]?.invoice_id || null;

    if (existing?.status === 'PAID') {
      await this.prisma.refund.update({ where: { id: existing.id }, data: { source_key: null } });
    } else if (existing) {
      return this.prisma.refund.update({
        where: { id: existing.id },
        data: {
          amount,
          reason: 'Kelebihan ongkir pengiriman terdeteksi otomatis.',
          order_id,
          invoice_id,
          customer_id: order?.customer_id || null,
        },
      });
    }

    const refund = await this.prisma.refund.upsert({
      where: { source_key },
      update: {
        amount,
        reason: 'Kelebihan ongkir pengiriman terdeteksi otomatis.',
        order_id,
        invoice_id,
        customer_id: order?.customer_id || null,
        source: 'SHIPPING_OVERPAYMENT',
      },
      create: {
        refund_number: sequence('REF-ONGKIR'),
        order_id,
        invoice_id,
        customer_id: order?.customer_id || null,
        amount,
        reason: 'Kelebihan ongkir pengiriman terdeteksi otomatis.',
        source: 'SHIPPING_OVERPAYMENT',
        source_key,
        auto_generated: true,
        status: 'REQUESTED',
      },
    });

    if (invoice_id) {
      await this.prisma.invoice.update({
        where: { id: invoice_id },
        data: { status: 'REFUND_DUE' },
      });
    }
    return refund;
  }
}

