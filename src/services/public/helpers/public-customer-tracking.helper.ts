import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { maskName, maskPhone, maskAddress } from './public-masking.helper';
import { buildTrackingTimelineResponse } from './public-tracking.helper';

interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}

const verificationAttempts = new Map<string, AttemptRecord>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

function checkRateLimit(key: string) {
  const now = Date.now();
  const record = verificationAttempts.get(key);
  if (!record) return;

  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingMinutes = Math.ceil((record.lockedUntil - now) / 60000);
    throw new ForbiddenException(
      `Terlalu banyak percobaan verifikasi yang gagal. Silakan coba lagi dalam ${remainingMinutes} menit.`
    );
  }

  if (now - record.firstAttemptAt > WINDOW_MS) {
    verificationAttempts.delete(key);
  }
}

function recordFailedAttempt(key: string) {
  const now = Date.now();
  const record = verificationAttempts.get(key);
  if (!record || now - record.firstAttemptAt > WINDOW_MS) {
    verificationAttempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }

  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
  }
  verificationAttempts.set(key, record);
}

function clearAttempts(key: string) {
  verificationAttempts.delete(key);
}

export async function verifyAndFetchCustomerInvoices(
  prisma: PrismaService,
  rawCustomerCode: string,
  rawPhoneLast5: string
) {
  const cleanCode = String(rawCustomerCode || '').trim();
  const cleanLast5 = String(rawPhoneLast5 || '').replace(/\D/g, '');

  if (!cleanCode || cleanCode.length < 2) {
    throw new BadRequestException(
      'Masukkan Customer ID yang valid (contoh: CUST-0001).'
    );
  }

  if (cleanLast5.length !== 5) {
    throw new BadRequestException(
      'Masukkan 5 digit terakhir nomor WhatsApp terdaftar Anda untuk verifikasi keamanan.'
    );
  }

  const rateLimitKey = cleanCode.toUpperCase();
  checkRateLimit(rateLimitKey);

  // Lookup customer by customer_code (or numeric ID if digits only)
  const isNumericOnly = /^\d+$/.test(cleanCode);
  const customer = await prisma.customer.findFirst({
    where: {
      deleted_at: null,
      OR: [
        { customer_code: { equals: cleanCode, mode: 'insensitive' } },
        ...(isNumericOnly
          ? [
              { id: Number(cleanCode) },
              {
                customer_code: {
                  endsWith: `-${cleanCode.padStart(4, '0')}`,
                  mode: 'insensitive' as const,
                },
              },
            ]
          : []),
      ],
    },
  });

  if (!customer) {
    recordFailedAttempt(rateLimitKey);
    throw new NotFoundException(
      'Kombinasi Customer ID dan 5 digit terakhir nomor WhatsApp tidak ditemukan atau tidak sesuai.'
    );
  }

  const customerPhoneDigits = String(customer.whatsapp || '').replace(/\D/g, '');
  const actualLast5 = customerPhoneDigits.slice(-5);

  if (!actualLast5 || actualLast5.length < 5 || actualLast5 !== cleanLast5) {
    recordFailedAttempt(rateLimitKey);
    throw new ForbiddenException(
      'Verifikasi gagal: 5 digit terakhir nomor WhatsApp tidak sesuai dengan Customer ID tersebut.'
    );
  }

  clearAttempts(rateLimitKey);

  // Fetch all non-deleted invoices belonging to this customer
  const invoices = await prisma.invoice.findMany({
    where: {
      customer_id: customer.id,
      deleted_at: null,
    },
    orderBy: [{ invoice_date: 'desc' }, { created_at: 'desc' }],
    include: {
      orders: {
        orderBy: { created_at: 'asc' },
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
              shipments: {
                orderBy: { created_at: 'desc' },
              },
            },
          },
        },
      },
      payments: {
        where: { deleted_at: null },
        orderBy: [{ payment_date: 'desc' }, { id: 'desc' }],
      },
      refunds: {
        where: { deleted_at: null },
        orderBy: [{ refunded_at: 'desc' }, { created_at: 'desc' }],
      },
    },
  });

  const formattedInvoices = invoices
    .filter((inv) => {
      // Exclude invoices whose orders were all soft-deleted
      const activeOrders = (inv.orders || []).filter(
        (link) => link.order && !link.order.deleted_at
      );
      return activeOrders.length > 0;
    })
    .map((inv) => {
      const activeOrders = (inv.orders || [])
        .map((link) => link.order)
        .filter((ord): ord is NonNullable<typeof ord> => Boolean(ord && !ord.deleted_at));

      const primaryOrder = activeOrders[0] || null;
      const trackingData = primaryOrder
        ? buildTrackingTimelineResponse(primaryOrder, inv)
        : null;

      const orderTrackingList = activeOrders.map((ord) =>
        buildTrackingTimelineResponse(ord, inv)
      );

      const events = Array.from(
        new Set(
          activeOrders
            .map((ord) => ord.period?.name)
            .filter((name): name is string => Boolean(name))
        )
      );

      const totalItemsCount = activeOrders.reduce(
        (acc, ord) =>
          acc +
          (ord.items || []).reduce(
            (sum, item) => sum + Number(item.quantity || 0),
            0
          ),
        0
      );

      const latestShipment =
        activeOrders.flatMap((ord) => ord.shipments || [])[0] || null;

      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        issue_date: inv.invoice_date,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        status: inv.status,
        total_bill: Number(inv.total_bill || 0),
        paid_amount: Number(inv.paid_amount || 0),
        outstanding_amount: Number(inv.outstanding_amount || 0),
        shipping_method: inv.shipping_method,
        shopee_username: inv.shopee_username,
        events,
        order_count: activeOrders.length,
        order_numbers: activeOrders.map((ord) => ord.order_number),
        total_items_count: totalItemsCount,
        primary_order_status: primaryOrder?.status || 'NEW',
        shipment_summary: latestShipment
          ? {
              courier: latestShipment.courier,
              tracking_number: latestShipment.tracking_number,
              service_type: latestShipment.service_type,
              status: latestShipment.status,
              shipped_at: latestShipment.shipped_at,
            }
          : null,
        tracking: trackingData,
        orders_tracking: orderTrackingList,
      };
    });

  const unpaidCount = formattedInvoices.filter(
    (inv) => inv.outstanding_amount > 0 && inv.status !== 'PAID'
  ).length;

  return {
    verified: true,
    customer: {
      id: customer.id,
      customer_code: customer.customer_code,
      full_name: customer.full_name,
      masked_name: maskName(customer.full_name),
      masked_phone: `${maskPhone(customer.whatsapp)} (••${cleanLast5})`,
      destination_city: maskAddress(customer.address, customer.city),
      segment: customer.segment,
      deposit_balance: Number(customer.deposit_balance || 0),
    },
    summary: {
      total_invoices: formattedInvoices.length,
      unpaid_invoices: unpaidCount,
      paid_invoices: formattedInvoices.filter((inv) => inv.status === 'PAID')
        .length,
    },
    invoices: formattedInvoices,
  };
}
