import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';

export async function validateInvoiceOrders(
  prisma: PrismaService,
  customer_id: number,
  orderIds: number[],
  currentInvoiceId?: number,
) {
  const uniqueIds = [...new Set(orderIds)];
  const orders = await prisma.order.findMany({
    where: { id: { in: uniqueIds }, deleted_at: null },
    include: {
      invoice_links: { include: { invoice: { include: { payments: true, refunds: true } } } },
      customer: true,
      period: true,
    },
  });

  if (orders.length !== uniqueIds.length) {
    throw new BadRequestException('Satu atau beberapa pesanan tidak ditemukan.');
  }

  if (orders.some((order) => order.customer_id !== customer_id)) {
    throw new BadRequestException('Invoice campuran hanya dapat memuat pesanan dari pelanggan yang sama.');
  }

  const alreadyLinked = orders.find((order) =>
    order.invoice_links.some((link) => {
      if (link.invoice_id === currentInvoiceId) return false;
      const legacyCanBeReplaced =
        link.invoice.invoice_number.startsWith('WTB-LEGACY-') &&
        link.invoice.payments.length === 0 &&
        link.invoice.refunds.length === 0;
      return !legacyCanBeReplaced;
    })
  );

  if (alreadyLinked) {
    throw new BadRequestException(
      `${alreadyLinked.order_number} sudah digunakan pada invoice lain yang memiliki histori transaksi.`
    );
  }

  return orders;
}

export function extractLegacyInvoiceIds(orders: any[], currentInvoiceId?: number): number[] {
  return [
    ...new Set(
      orders
        .flatMap((order) => order.invoice_links)
        .filter((link) => {
          if (currentInvoiceId && link.invoice_id === currentInvoiceId) return false;
          return link.invoice.invoice_number.startsWith('WTB-LEGACY-');
        })
        .map((link) => link.invoice_id)
    ),
  ];
}
