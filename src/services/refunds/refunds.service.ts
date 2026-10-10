import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { CustomersService } from '../customers/customers.service';
import { sequence } from '../../common/utils/http.utils';

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
    if (!body.order_id && !body.invoice_id && !body.customer_id) {
      throw new BadRequestException('Pilih minimal satu target: pelanggan, invoice, atau pesanan.');
    }

    const resolvedOrderId = body.order_id ? Number(body.order_id) : null;
    const resolvedInvoiceId = body.invoice_id ? Number(body.invoice_id) : null;

    let customer_id = body.customer_id ? Number(body.customer_id) : null;
    if (!customer_id && resolvedOrderId) {
      const order = await this.prisma.order.findUnique({ where: { id: resolvedOrderId }, select: { customer_id: true } });
      customer_id = order?.customer_id || null;
    } else if (!customer_id && resolvedInvoiceId) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: resolvedInvoiceId }, select: { customer_id: true } });
      customer_id = invoice?.customer_id || null;
    }

    const refund_type = body.refund_type || 'CUSTOMER_DEPOSIT';

    const data = await this.prisma.refund.create({
      data: {
        ...body,
        order_id: resolvedOrderId,
        invoice_id: resolvedInvoiceId,
        customer_id,
        refund_type,
        refund_number: body.refund_number || sequence('REF'),
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
    const resolvedOrderId = body.order_id === undefined ? current.order_id : body.order_id || null;
    const resolvedInvoiceId = body.invoice_id === undefined ? current.invoice_id : body.invoice_id || null;
    
    let customer_id = current.customer_id || current.order?.customer_id || current.invoice?.customer_id || null;
    if (body.customer_id) customer_id = Number(body.customer_id);

    if (!resolvedOrderId && !resolvedInvoiceId && !customer_id) {
      throw new BadRequestException('Pilih minimal satu target refund: pelanggan, invoice, atau pesanan.');
    }

    // Customer ID already resolved above

    // If changing from PAID + CUSTOMER_DEPOSIT to REJECTED or DIRECT_TRANSFER, check available deposit
    if (
      customer_id &&
      current.status === 'PAID' &&
      current.refund_type === 'CUSTOMER_DEPOSIT' &&
      (body.status === 'REJECTED' || (body.refund_type && body.refund_type !== 'CUSTOMER_DEPOSIT'))
    ) {
      const balance = await this.customersService.getDepositBalance(customer_id);
      if (balance.availableDeposit < Number(current.amount)) {
        throw new BadRequestException(
          `Sebagian saldo deposit (${current.refund_number}) telah terpakai pada invoice aktif pelanggan. Batalkan pemakaian deposit di invoice terlebih dahulu.`
        );
      }
    }

    const paidAutoOverpayment = body.status === 'PAID' && current.auto_generated && current.source === 'OVERPAYMENT';
    const data = await this.prisma.refund.update({
      where: { id },
      data: {
        ...body,
        order_id: body.order_id === undefined ? undefined : body.order_id || null,
        invoice_id: body.invoice_id === undefined ? undefined : body.invoice_id || null,
        customer_id: customer_id || undefined,
        refund_type: body.refund_type !== undefined ? body.refund_type : undefined,
        refunded_at: body.status === 'PAID' && !body.refunded_at ? new Date() : body.refunded_at,
        ...(paidAutoOverpayment ? { source_key: null } : {}),
      },
      include: { customer: true, invoice: { include: { customer: true } }, order: { include: { customer: true } } },
    });

    if (body.status === 'PAID' && data.order_id) {
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
