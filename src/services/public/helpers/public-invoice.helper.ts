import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import {
  insertPaymentRecord,
  applyPublicShippingAndStoragePreferences,
} from './public-payment-submission.helper';
import { DEFAULT_SHIPMENT_CONFIG } from '../../settings/settings.service';

export async function fetchPublicInvoiceData(
  prisma: PrismaService,
  invoiceNumber: string
) {
  if (!invoiceNumber || !invoiceNumber.trim()) {
    throw new NotFoundException('Nomor invoice tidak valid.');
  }
  const cleanNumber = invoiceNumber.trim();
  const invoice = await prisma.invoice.findFirst({
    where: {
      invoice_number: cleanNumber,
      deleted_at: null,
    },
    include: {
      customer: {
        select: {
          id: true,
          full_name: true,
          whatsapp: true,
          email: true,
        },
      },
      orders: {
        orderBy: { created_at: 'asc' },
        include: {
          order: {
            include: {
              period: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  city: true,
                  country: true,
                },
              },
              items: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      brand_name: true,
                      image_url: true,
                    },
                  },
                },
              },
              shipments: {
                select: {
                  id: true,
                  courier: true,
                  service_type: true,
                  shipping_method: true,
                  tracking_number: true,
                  shopee_order_no: true,
                  shopee_variant: true,
                  status: true,
                },
              },
            },
          },
        },
      },
      payments: {
        where: { deleted_at: null },
        orderBy: [{ payment_date: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          payment_number: true,
          amount: true,
          method: true,
          destination_account: true,
          proof_url: true,
          status: true,
          payment_date: true,
          notes: true,
          created_at: true,
        },
      },
      refunds: {
        where: { deleted_at: null },
        orderBy: [{ refunded_at: 'desc' }, { created_at: 'desc' }],
        select: {
          id: true,
          refund_number: true,
          amount: true,
          refund_type: true,
          reason: true,
          status: true,
          source: true,
          refunded_at: true,
          bank_name: true,
          account_number: true,
          account_holder: true,
          proof_url: true,
          transfer_notes: true,
          notes: true,
          created_at: true,
        },
      },
    },
  });

  if (!invoice) {
    throw new NotFoundException(`Invoice "${cleanNumber}" tidak ditemukan.`);
  }

  // Trigger CUSTOMER_CHECKED status when the customer opens this public invoice page
  // (only if still ISSUED and not yet paid)
  if (invoice.status === 'ISSUED' && Number(invoice.paid_amount || 0) <= 0) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'CUSTOMER_CHECKED' as any },
    });
    (invoice as any).status = 'CUSTOMER_CHECKED';
  }

  // Ensure total_bill and outstanding_amount exclude unavailable orders/items
  if (Array.isArray(invoice.orders) && invoice.orders.length > 0) {
    const isOrderUnavailable = (ord: any) =>
      ord?.status === 'UNAVAILABLE' ||
      (Array.isArray(ord?.items) &&
        ord.items.length > 0 &&
        ord.items.every((it: any) => it.fulfillment_status === 'UNAVAILABLE'));

    const calculatedTotalBill = invoice.orders.reduce((sum, link) => {
      if (isOrderUnavailable(link.order)) return sum;
      return sum + Number(link.order?.total_bill ?? link.snapshot_amount ?? 0);
    }, 0);

    const paidAmount = Number(invoice.paid_amount || 0);
    const depositAmount = Number(invoice.deposit_amount || 0);
    const effectivePaid = paidAmount + depositAmount;
    const calculatedOutstanding = Math.max(0, calculatedTotalBill - effectivePaid);

    (invoice as any).total_bill = calculatedTotalBill;
    (invoice as any).outstanding_amount = calculatedOutstanding;
  }

  const [rawSettings, brandRecord, invoiceRecord, shippingCounters] = await Promise.all([
    prisma.setting.findMany(),
    prisma.brand_setting.findFirst({ orderBy: { id: 'desc' } }),
    prisma.invoice_setting.findFirst({ orderBy: { id: 'desc' } }),
    prisma.shipping_counter.findMany({
      where: { deleted_at: null, is_active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true },
    }),
  ]);
  const settings: Record<string, any> = Object.fromEntries(
    rawSettings.map((x) => [x.key, x.value])
  );

  const invoiceSettings = settings['invoice'] || {};
  const brandSettings = settings['brand'] || {};
  const shipmentSettings = {
    ...DEFAULT_SHIPMENT_CONFIG,
    ...(settings['shipment'] || {}),
  };

  return {
    invoice,
    shipmentSettings,
    shippingCounters,
    bankSettings: {
      bankName:
        invoiceRecord?.bank_name ||
        invoiceSettings.bankName ||
        process.env.DEFAULT_BANK_NAME ||
        'BCA (Bank Central Asia)',
      accountNumber:
        invoiceRecord?.account_number ||
        invoiceSettings.accountNumber ||
        process.env.DEFAULT_BANK_ACCOUNT ||
        '1234567890',
      accountHolder:
        invoiceRecord?.account_holder ||
        invoiceSettings.accountHolder ||
        process.env.DEFAULT_BANK_HOLDER ||
        'WORTHTOBUY',
      footer: invoiceRecord?.footer || invoiceSettings.footer || '',
      brandName:
        brandRecord?.name ||
        brandSettings.name ||
        process.env.BRAND_NAME ||
        'WORTHTOBUY',
      whatsapp:
        brandRecord?.whatsapp ||
        invoiceRecord?.whatsapp ||
        brandSettings.whatsapp ||
        invoiceSettings.whatsapp ||
        process.env.BRAND_WHATSAPP ||
        '6285186852535',
      qrisImageUrl:
        (invoiceRecord as any)?.qris_image_url ||
        invoiceSettings.qrisImageUrl ||
        invoiceSettings.qrisImage ||
        brandSettings.qrisImageUrl ||
        process.env.DEFAULT_QRIS_IMAGE_URL ||
        '',
      shopeeStoreUrl: shipmentSettings.shopeeStoreUrl || '',
      shopeeStoreName: shipmentSettings.shopeeStoreName || '',
      shopeeCheckoutInstruction: shipmentSettings.shopeeCheckoutInstruction || '',
      feeRules: settings['feeRules'] || null,
      feeRulesReseller: settings['feeRulesReseller'] || null,
    },
  };
}

export async function createPublicPaymentProof(
  prisma: PrismaService,
  invoiceNumber: string,
  body: any
) {
  if (!invoiceNumber || !invoiceNumber.trim()) {
    throw new BadRequestException('Nomor invoice diperlukan.');
  }
  const cleanNumber = invoiceNumber.trim();
  const invoice = await prisma.invoice.findFirst({
    where: {
      invoice_number: cleanNumber,
      deleted_at: null,
    },
    include: {
      customer: true,
      orders: { include: { order: true } },
    },
  });

  if (!invoice) {
    throw new NotFoundException(`Invoice "${cleanNumber}" tidak ditemukan.`);
  }

  if (invoice.status === 'ISSUED' && Number(invoice.paid_amount || 0) <= 0) {
    throw new BadRequestException(
      'Invoice ini sedang direvisi/diterbitkan ulang oleh Admin. Silakan muat ulang (refresh) halaman ini terlebih dahulu untuk mengecek rincian pesanan terbaru sebelum melakukan transfer.'
    );
  }

  if (Number(invoice.outstanding_amount) <= 0 || invoice.status === 'PAID') {
    throw new BadRequestException('Tagihan invoice ini sudah lunas.');
  }

  const method = String(body.method || 'Bank Transfer').trim();

  const pendingPayments = await prisma.payment.findMany({
    where: {
      deleted_at: null,
      invoice_id: invoice.id,
      status: 'PENDING',
    },
    select: { amount: true },
  });
  const pendingSum = pendingPayments.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0
  );
  const remainingToUpload = Math.max(
    0,
    Number(invoice.outstanding_amount || 0) - pendingSum
  );
  if (remainingToUpload <= 0) {
    throw new BadRequestException(
      'Total bukti pembayaran yang diunggah sudah memenuhi total tagihan invoice. ' +
      'Harap menunggu verifikasi tim admin.'
    );
  }

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    throw new BadRequestException(
      'Nominal pembayaran harus lebih besar dari 0.'
    );
  }

  if (!body.proof_url || !String(body.proof_url).trim()) {
    throw new BadRequestException(
      'Bukti transfer (gambar/screenshot) wajib diunggah.'
    );
  }

  const proof_url = String(body.proof_url).trim();

  // Prevent duplicate within 15 seconds
  const recentDuplicate = await prisma.payment.findFirst({
    where: {
      deleted_at: null,
      invoice_id: invoice.id,
      amount,
      created_at: { gte: new Date(Date.now() - 15 * 1000) },
    },
  });
  if (recentDuplicate) {
    throw new BadRequestException(
      'Bukti pembayaran baru saja dikirimkan. Harap tunggu konfirmasi.'
    );
  }

  // Prevent duplicate proof URL
  const sameProof = await prisma.payment.findFirst({
    where: {
      deleted_at: null,
      invoice_id: invoice.id,
      proof_url,
    },
  });
  if (sameProof) {
    throw new BadRequestException(
      'Bukti transfer ini sudah pernah diunggah sebelumnya.'
    );
  }

  const payment = await insertPaymentRecord(
    prisma,
    invoice,
    body,
    method,
    amount,
    proof_url
  );

  return {
    success: true,
    message: 'Bukti transfer berhasil dikirim. Menunggu verifikasi tim admin.',
    payment,
  };
}

export async function updatePublicShippingMethod(
  prisma: PrismaService,
  invoiceNumber: string,
  body: any
) {
  if (!invoiceNumber || !invoiceNumber.trim()) {
    throw new BadRequestException('Nomor invoice diperlukan.');
  }
  const cleanNumber = invoiceNumber.trim();
  const invoice = await prisma.invoice.findFirst({
    where: {
      invoice_number: cleanNumber,
      deleted_at: null,
    },
    include: {
      orders: true,
    },
  });

  if (!invoice) {
    throw new NotFoundException(`Invoice "${cleanNumber}" tidak ditemukan.`);
  }

  const updatedPrefs = await applyPublicShippingAndStoragePreferences(
    prisma,
    invoice,
    body
  );

  return {
    success: true,
    message: 'Pengaturan pengiriman berhasil disimpan.',
    ...updatedPrefs,
  };
}
