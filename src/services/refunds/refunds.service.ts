import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { CustomersService } from '../customers/customers.service';
import { sequence } from '../../common/utils/http.utils';

function cleanRefundData(body: any): any {
  if (!body || typeof body !== 'object') return {};
  const cleaned: any = {};

  if (body.refund_number !== undefined || body.refundNumber !== undefined) {
    const val = body.refund_number !== undefined ? body.refund_number : body.refundNumber;
    cleaned.refund_number = val ? String(val).trim() : undefined;
  }
  if (body.order_id !== undefined || body.orderId !== undefined) {
    const val = body.order_id !== undefined ? body.order_id : body.orderId;
    cleaned.order_id = val ? Number(val) : null;
  }
  if (body.invoice_id !== undefined || body.invoiceId !== undefined) {
    const val = body.invoice_id !== undefined ? body.invoice_id : body.invoiceId;
    cleaned.invoice_id = val ? Number(val) : null;
  }
  if (body.customer_id !== undefined || body.customerId !== undefined) {
    const val = body.customer_id !== undefined ? body.customer_id : body.customerId;
    cleaned.customer_id = val ? Number(val) : null;
  }
  if (body.refund_type !== undefined || body.refundType !== undefined) {
    cleaned.refund_type = body.refund_type !== undefined ? body.refund_type : body.refundType;
  }
  if (body.amount !== undefined) {
    cleaned.amount = Number(body.amount);
  }
  if (body.reason !== undefined) {
    cleaned.reason = String(body.reason || '').trim();
  }
  if (body.status !== undefined) {
    cleaned.status = body.status;
  }
  if (body.source !== undefined) {
    cleaned.source = body.source;
  }
  if (body.refunded_at !== undefined || body.refundedAt !== undefined) {
    const val = body.refunded_at !== undefined ? body.refunded_at : body.refundedAt;
    cleaned.refunded_at = val ? new Date(val) : null;
  }
  if (body.notes !== undefined) {
    cleaned.notes = body.notes ? String(body.notes).trim() : null;
  }

  return cleaned;
}

@Injectable()
export class RefundsService {
  constructor(
    private prisma: PrismaService,
    private invoiceCalcService: InvoiceCalcService,
    private customersService: CustomersService,
  ) { }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim().slice(0, 100);
    const status = query.status && query.status !== 'ALL' ? String(query.status) : undefined;
    const source = query.source && query.source !== 'ALL' ? String(query.source) : undefined;
    const refund_type = query.refund_type && query.refund_type !== 'ALL' ? String(query.refund_type) : undefined;

    const where: any = {
      deleted_at: null,
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
      ...(refund_type ? { refund_type } : {}),
      AND: [
        { OR: [{ order: { deleted_at: null } }, { invoice: { deleted_at: null } }] },
        ...(search
          ? [
            {
              OR: [
                { refund_number: { contains: search, mode: 'insensitive' } },
                { reason: { contains: search, mode: 'insensitive' } },
                { invoice: { invoice_number: { contains: search, mode: 'insensitive' } } },
                { order: { order_number: { contains: search, mode: 'insensitive' } } },
                { invoice: { customer: { full_name: { contains: search, mode: 'insensitive' } } } },
                { order: { customer: { full_name: { contains: search, mode: 'insensitive' } } } },
                { customer: { full_name: { contains: search, mode: 'insensitive' } } },
                { invoice: { customer: { whatsapp: { contains: search } } } },
                { order: { customer: { whatsapp: { contains: search } } } },
                { customer: { whatsapp: { contains: search } } },
                { notes: { contains: search, mode: 'insensitive' } },
              ],
            },
          ]
          : []),
      ],
    };

    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          order: { include: { customer: true } },
          invoice: { include: { customer: true } },
          customer: true,
        },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async create(body: any) {
    const cleaned = cleanRefundData(body);
    const resolvedOrderId = cleaned.order_id ?? null;
    const resolvedInvoiceId = cleaned.invoice_id ?? null;
    let customer_id = cleaned.customer_id ?? null;

    if (!resolvedOrderId && !resolvedInvoiceId && !customer_id) {
      throw new BadRequestException('Pilih minimal satu target: pelanggan, invoice, atau pesanan.');
    }

    if (!customer_id && resolvedOrderId) {
      const order = await this.prisma.order.findUnique({ where: { id: resolvedOrderId }, select: { customer_id: true } });
      customer_id = order?.customer_id || null;
    } else if (!customer_id && resolvedInvoiceId) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: resolvedInvoiceId }, select: { customer_id: true } });
      customer_id = invoice?.customer_id || null;
    }

    const refund_type = cleaned.refund_type || 'CUSTOMER_DEPOSIT';

    const data = await this.prisma.refund.create({
      data: {
        ...cleaned,
        order_id: resolvedOrderId,
        invoice_id: resolvedInvoiceId,
        customer_id,
        refund_type,
        refund_number: cleaned.refund_number || sequence('REF'),
        auto_generated: false,
      },
      include: { customer: true, invoice: { include: { customer: true } }, order: { include: { customer: true } } },
    });

    if (data.status === 'PAID' && data.order_id) {
      await this.prisma.order.update({ where: { id: data.order_id }, data: { status: 'REFUND' } });
    }
    if (data.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(data.invoice_id);
    }
    if (customer_id) {
      await this.customersService.recalculateCustomerDeposit(customer_id);
    }
    return data;
  }

  async update(id: number, body: any) {
    const current = await this.prisma.refund.findUniqueOrThrow({
      where: { id },
      include: { order: true, invoice: true },
    });
    const cleaned = cleanRefundData(body);
    const resolvedOrderId = cleaned.order_id === undefined ? current.order_id : cleaned.order_id || null;
    const resolvedInvoiceId = cleaned.invoice_id === undefined ? current.invoice_id : cleaned.invoice_id || null;
    
    let customer_id = current.customer_id || current.order?.customer_id || current.invoice?.customer_id || null;
    if (cleaned.customer_id) customer_id = Number(cleaned.customer_id);

    if (!resolvedOrderId && !resolvedInvoiceId && !customer_id) {
      throw new BadRequestException('Pilih minimal satu target refund: pelanggan, invoice, atau pesanan.');
    }

    // Customer ID already resolved above

    // If changing from PAID + CUSTOMER_DEPOSIT to REJECTED or DIRECT_TRANSFER, check available deposit
    if (
      customer_id &&
      current.status === 'PAID' &&
      current.refund_type === 'CUSTOMER_DEPOSIT' &&
      (cleaned.status === 'REJECTED' || (cleaned.refund_type && cleaned.refund_type !== 'CUSTOMER_DEPOSIT'))
    ) {
      const balance = await this.customersService.getDepositBalance(customer_id);
      if (balance.availableDeposit < Number(current.amount)) {
        throw new BadRequestException(
          `Sebagian saldo deposit (${current.refund_number}) telah terpakai pada invoice aktif pelanggan. Batalkan pemakaian deposit di invoice terlebih dahulu.`
        );
      }
    }

    const paidAutoOverpayment = cleaned.status === 'PAID' && current.auto_generated && current.source === 'OVERPAYMENT';
    const data = await this.prisma.refund.update({
      where: { id },
      data: {
        ...cleaned,
        order_id: cleaned.order_id === undefined ? undefined : cleaned.order_id || null,
        invoice_id: cleaned.invoice_id === undefined ? undefined : cleaned.invoice_id || null,
        customer_id: customer_id || undefined,
        refund_type: cleaned.refund_type !== undefined ? cleaned.refund_type : undefined,
        refunded_at: cleaned.status === 'PAID' && !cleaned.refunded_at ? new Date() : cleaned.refunded_at,
        ...(paidAutoOverpayment ? { source_key: null } : {}),
      },
      include: { customer: true, invoice: { include: { customer: true } }, order: { include: { customer: true } } },
    });

    if (cleaned.status === 'PAID' && data.order_id) {
      await this.prisma.order.update({ where: { id: data.order_id }, data: { status: 'REFUND' } });
    }
    if (current.invoice_id && current.invoice_id !== data.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(current.invoice_id);
    }
    if (data.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(data.invoice_id);
    }
    if (customer_id) {
      await this.customersService.recalculateCustomerDeposit(customer_id);
    }
    return data;
  }

  async processRefund(id: number, body: { refund_type: 'CUSTOMER_DEPOSIT' | 'DIRECT_TRANSFER'; notes?: string; refunded_at?: any }) {
    return this.update(id, {
      status: 'PAID',
      refund_type: body.refund_type,
      notes: body.notes,
      refunded_at: body.refunded_at || new Date(),
    });
  }

  async remove(id: number, user_id?: number) {
    const data = await this.prisma.refund.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
      include: { order: true, invoice: true },
    });
    if (data.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(data.invoice_id);
    }
    const customer_id = data.customer_id || data.order?.customer_id || data.invoice?.customer_id;
    if (customer_id) {
      await this.customersService.recalculateCustomerDeposit(customer_id);
    }
    return { success: true };
  }
}
