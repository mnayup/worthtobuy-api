import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';

export async function findPublicTargetOrder(
  prisma: PrismaService,
  clean: string
) {
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
              items: {
                include: {
                  product: true,
                  purchases: {
                    where: { status: 'PURCHASED' },
                    orderBy: { purchase_date: 'desc' },
                    take: 1,
                  },
                },
              },
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
        items: {
          include: {
            product: true,
            purchases: {
              where: { status: 'PURCHASED' },
              orderBy: { purchase_date: 'desc' },
              take: 1,
            },
          },
        },
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
            items: {
              include: {
                product: true,
                purchases: {
                  where: { status: 'PURCHASED' },
                  orderBy: { purchase_date: 'desc' },
                  take: 1,
                },
              },
            },
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
            items: {
              include: {
                product: true,
                purchases: {
                  where: { status: 'PURCHASED' },
                  orderBy: { purchase_date: 'desc' },
                  take: 1,
                },
              },
            },
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
      `Pesanan dengan nomor "${clean}" tidak ditemukan. Pastikan nomor ` +
      `Invoice (INV-...), nomor Order (ORD-...), atau nomor resi kurir ` +
      `sudah benar.`
    );
  }

  return { targetOrder, invoice };
}
