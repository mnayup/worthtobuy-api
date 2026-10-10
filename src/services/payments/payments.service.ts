import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { sequence } from '../../common/utils/http.utils';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private invoiceCalcService: InvoiceCalcService,
  ) { }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const status = query.status && query.status !== 'ALL' ? String(query.status) : undefined;
    const method = query.method && query.method !== 'ALL' ? String(query.method) : undefined;
    const search = String(query.search || '').trim().slice(0, 100);

    const where: any = {
      deleted_at: null,
      ...(status ? { status } : {}),
      ...(method ? { method: { contains: method, mode: 'insensitive' } } : {}),
      AND: [
        { OR: [{ order: { deleted_at: null } }, { invoice: { deleted_at: null } }] },
        ...(search
          ? [
            {
              OR: [
                { payment_number: { contains: search, mode: 'insensitive' } },
                { invoice: { invoice_number: { contains: search, mode: 'insensitive' } } },
                { order: { order_number: { contains: search, mode: 'insensitive' } } },
                { invoice: { customer: { full_name: { contains: search, mode: 'insensitive' } } } },
                { order: { customer: { full_name: { contains: search, mode: 'insensitive' } } } },
                { invoice: { customer: { whatsapp: { contains: search } } } },
                { order: { customer: { whatsapp: { contains: search } } } },
                { method: { contains: search, mode: 'insensitive' } },
                { destination_account: { contains: search, mode: 'insensitive' } },
                { notes: { contains: search, mode: 'insensitive' } },
                { verified_by: { name: { contains: search, mode: 'insensitive' } } },
              ],
            },
          ]
          : []),
      ],
    };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { payment_date: 'desc' },
        include: {
          order: { include: { customer: true } },
          invoice: { include: { customer: true } },
          verified_by: { select: { name: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async create(body: any, user_id?: number) {
    if (Number(Boolean(body.order_id)) + Number(Boolean(body.invoice_id)) !== 1) {
      throw new BadRequestException('Pilih tepat satu target: invoice atau pesanan.');
    }

    // Prevent rapid double-clicks (submitting twice within 15 seconds)
    const recentDuplicate = await this.prisma.payment.findFirst({
      where: {
        deleted_at: null,
        order_id: body.order_id || null,
        invoice_id: body.invoice_id || null,
        amount: body.amount,
        created_at: { gte: new Date(Date.now() - 15 * 1000) },
      },
    });
    if (recentDuplicate) {
      throw new ConflictException(`Pembayaran serupa baru saja dicatat (${recentDuplicate.payment_number}). Hindari menekan tombol simpan berulang kali.`);
    }

    // Prevent duplicate upload of the exact same proof receipt URL
    if (body.proof_url) {
      const sameProof = await this.prisma.payment.findFirst({
        where: {
          deleted_at: null,
          order_id: body.order_id || null,
          invoice_id: body.invoice_id || null,
          proof_url: body.proof_url,
        },
      });
      if (sameProof) {
        throw new ConflictException(`Bukti transfer ini sudah pernah digunakan pada pembayaran ${sameProof.payment_number}.`);
      }
    }

    // If target is already fully paid, prevent adding another same-day identical payment
    let target: { outstanding_amount: any } | null = null;
    if (body.invoice_id) {
      target = await this.prisma.invoice.findUnique({ where: { id: Number(body.invoice_id) } });
    } else if (body.order_id) {
      target = await this.prisma.order.findUnique({ where: { id: Number(body.order_id) } });
    }

    if (target && Number(target.outstanding_amount) <= 0) {
      const payment_date = body.payment_date ? new Date(body.payment_date) : new Date();
      const start = new Date(payment_date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const duplicate = await this.prisma.payment.findFirst({
        where: {
          deleted_at: null,
          order_id: body.order_id || null,
          invoice_id: body.invoice_id || null,
          amount: body.amount,
          method: body.method,
          payment_date: { gte: start, lt: end },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Tagihan ini sudah lunas dan pembayaran serupa sudah tercatat (${duplicate.payment_number}).`);
      }
    }

    const data = await this.prisma.payment.create({
      data: {
        ...body,
        order_id: body.order_id || null,
        invoice_id: body.invoice_id || null,
        payment_number: body.payment_number || sequence('PAY'),
        verified_by_id: body.status === 'VERIFIED' ? user_id : null,
      },
      include: { order: { include: { customer: true } }, invoice: { include: { customer: true } } },
    });

    if (data.status === 'VERIFIED') {
      await this.invoiceCalcService.refreshPaymentTarget(data);
    }

    const customerName = data.invoice?.customer.full_name || data.order?.customer.full_name || '-';
    await this.prisma.notification.create({
      data: {
        type: 'PAYMENT',
        title: 'Pembayaran baru',
        message: `${data.payment_number} • ${customerName} • Rp${Number(data.amount).toLocaleString('id-ID')}`,
        link: data.invoice_id ? `/invoices/${data.invoice_id}` : '/payments',
      },
    });

    return data;
  }

  async update(id: number, body: any, user_id?: number) {
    const current = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    const resolvedOrderId = body.order_id === undefined ? current.order_id : body.order_id || null;
    const resolvedInvoiceId = body.invoice_id === undefined ? current.invoice_id : body.invoice_id || null;

    if (Number(Boolean(resolvedOrderId)) + Number(Boolean(resolvedInvoiceId)) !== 1) {
      throw new BadRequestException('Pilih tepat satu target pembayaran: invoice atau pesanan.');
    }

    const data = await this.prisma.payment.update({
      where: { id: current.id },
      data: {
        ...body,
        order_id: body.order_id === undefined ? undefined : body.order_id || null,
        invoice_id: body.invoice_id === undefined ? undefined : body.invoice_id || null,
        verified_by_id: body.status === 'VERIFIED' ? user_id : body.status ? null : undefined,
      },
    });

    await this.invoiceCalcService.refreshPaymentTarget({ invoice_id: current.invoice_id, order_id: current.order_id });
    await this.invoiceCalcService.refreshPaymentTarget(data);
    return data;
  }

  async remove(id: number, user_id?: number) {
    const payment = await this.prisma.payment.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });
    await this.invoiceCalcService.refreshPaymentTarget(payment);
    return { success: true };
  }
}
