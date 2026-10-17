import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { sequence } from '../../../common/utils/http.utils';

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
    },
  });

  if (!invoice) {
    throw new NotFoundException(`Invoice "${cleanNumber}" tidak ditemukan.`);
  }

  const [rawSettings, brandRecord, invoiceRecord] = await Promise.all([
    prisma.setting.findMany(),
    prisma.brand_setting.findFirst({ orderBy: { id: 'desc' } }),
    prisma.invoice_setting.findFirst({ orderBy: { id: 'desc' } }),
  ]);
  const settings: Record<string, any> = Object.fromEntries(
    rawSettings.map((x) => [x.key, x.value])
  );

  const invoiceSettings = settings['invoice'] || {};
  const brandSettings = settings['brand'] || {};

  return {
    invoice,
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

  if (Number(invoice.outstanding_amount) <= 0 || invoice.status === 'PAID') {
    throw new BadRequestException('Tagihan invoice ini sudah lunas.');
  }

  const pendingPayment = await prisma.payment.findFirst({
    where: {
      deleted_at: null,
      invoice_id: invoice.id,
      status: 'PENDING',
    },
  });
  if (pendingPayment) {
    throw new BadRequestException(
      'Bukti transfer sebelumnya sedang diverifikasi oleh admin. Harap menunggu.',
    );
  }

  const isPaidSome = Number(invoice.paid_amount) > 0;
  if (isPaidSome) {
    const isWaitingSettlement = (invoice.orders || []).some(
      (link) => link.order?.status === 'WAITING_SETTLEMENT',
    );
    if (!isWaitingSettlement) {
      throw new BadRequestException(
        'Pembayaran DP sudah diterima. Form pelunasan belum dibuka hingga status ' +
          'pesanan berubah menjadi Menunggu Pelunasan (Waiting for Settlement).',
      );
    }
  }

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    throw new BadRequestException('Nominal pembayaran harus lebih besar dari 0.');
  }

  if (!body.proof_url || !String(body.proof_url).trim()) {
    throw new BadRequestException('Bukti transfer (gambar/screenshot) wajib diunggah.');
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
      'Bukti pembayaran baru saja dikirimkan. Harap tunggu konfirmasi.',
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
    throw new BadRequestException('Bukti transfer ini sudah pernah diunggah sebelumnya.');
  }

  const method = String(body.method || 'Bank Transfer').trim();
  const destination_account = body.destination_account
    ? String(body.destination_account).trim()
    : null;
  const payment_date = body.payment_date ? new Date(body.payment_date) : new Date();
  const notes = body.notes ? String(body.notes).trim() : null;

  const payment = await prisma.payment.create({
    data: {
      invoice_id: invoice.id,
      payment_number: sequence('PAY'),
      amount,
      method,
      destination_account,
      proof_url,
      payment_date,
      notes,
      status: 'PENDING',
      verified_by_id: null,
    },
  });

  const rawKeepItem = body.keep_item !== undefined ? body.keep_item : body.keepItem;
  if (rawKeepItem !== undefined) {
    const isKeep = Boolean(rawKeepItem);
    const orderIds = (invoice.orders || []).map((link) => link.order_id);
    if (orderIds.length > 0) {
      // Set keep date until 1 month after payment submission
      const kept_until = isKeep ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
      await prisma.order_item.updateMany({
        where: { order_id: { in: orderIds } },
        data: { kept_until },
      });
    }
  }

  const customerName = invoice.customer?.full_name || 'Pelanggan';
  const notifMsg = `${invoice.invoice_number} • ${customerName} mengunggah bukti transfer `
    + `${method} Rp ${amount.toLocaleString('id-ID')}`;
  await prisma.notification.create({
    data: {
      type: 'PAYMENT',
      title: 'Bukti transfer baru diunggah pelanggan',
      message: notifMsg,
      link: `/invoices/${invoice.id}`,
    },
  });

  return {
    success: true,
    message: 'Bukti transfer berhasil dikirim. Menunggu verifikasi tim admin.',
    payment,
  };
}
