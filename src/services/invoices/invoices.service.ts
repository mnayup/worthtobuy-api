import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { CustomersService } from '../customers/customers.service';
import { sequence } from '../../common/utils/http.utils';
import {
  buildInvoiceWhereClause,
  buildAvailableOrdersWhereClause,
} from './helpers/invoice-query.helper';
import {
  validateInvoiceOrders,
  extractLegacyInvoiceIds,
} from './helpers/invoice-validation.helper';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private invoiceCalcService: InvoiceCalcService,
    private customersService: CustomersService,
  ) { }

  async getSummary() {
    const counts = await this.prisma.invoice.groupBy({
      by: ['status'],
      where: { deleted_at: null },
      _count: { id: true },
    });
    const total = await this.prisma.invoice.count({ where: { deleted_at: null } });
    const summary: Record<string, number> = { TOTAL: total };
    for (const c of counts) {
      summary[c.status] = c._count.id;
    }
    return summary;
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const where = buildInvoiceWhereClause(query);

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { invoice_date: 'desc' },
        include: {
          customer: true,
          orders: { include: { order: { include: { period: true } } } },
          payments: { where: { status: 'VERIFIED', deleted_at: null }, orderBy: { payment_date: 'desc' } },
          refunds: { where: { status: { not: 'REJECTED' }, deleted_at: null } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getAvailableOrders(query: any) {
    const where = buildAvailableOrdersWhereClause(query);
    return this.prisma.order.findMany({
      where,
      orderBy: { order_date: 'desc' },
      include: { customer: true, period: true, items: { include: { product: true } } },
      take: 100,
    });
  }

  async findOne(id: number) {
    const data = await this.prisma.invoice.findFirstOrThrow({
      where: { id, deleted_at: null },
      include: {
        customer: true,
        orders: {
          orderBy: { created_at: 'asc' },
          include: {
            order: {
              include: {
                period: true,
                admin: { select: { name: true } },
                items: { include: { product: true, status_histories: { orderBy: { created_at: 'desc' }, take: 5 } } },
                shipments: true,
              },
            },
          },
        },
        payments: { where: { deleted_at: null }, orderBy: [{ payment_date: 'desc' }, { id: 'desc' }] },
        refunds: { where: { deleted_at: null }, orderBy: { created_at: 'desc' } },
      },
    });

    const orderIds = data.orders.map((link) => link.order_id);
    const legacyPayments = orderIds.length
      ? await this.prisma.payment.findMany({
        where: { order_id: { in: orderIds }, invoice_id: null },
        orderBy: [{ payment_date: 'desc' }, { id: 'desc' }],
      })
      : [];

    const paymentMap = new Map<number, any>();
    [...data.payments, ...legacyPayments].forEach((payment) => paymentMap.set(payment.id, payment));

    return {
      ...data,
      payments: [...paymentMap.values()].sort((a, b) => b.payment_date.getTime() - a.payment_date.getTime()),
    };
  }

  async create(body: any) {
    const customer_id = body.customer_id ? Number(body.customer_id) : body.customerId ? Number(body.customerId) : null;
    const orderIds = body.order_ids ?? body.orderIds ?? [];
    const orders = await validateInvoiceOrders(this.prisma, customer_id, orderIds);
    const total_bill = orders.reduce((sum, order) => sum + Number(order.total_bill), 0);
    const legacyInvoiceIds = extractLegacyInvoiceIds(orders);

    const rawUseDeposit = body.use_deposit ?? body.useDeposit;
    const rawDepositAmount = body.deposit_amount ?? body.depositAmount;
    const deposit_amount = rawUseDeposit ? Number(rawDepositAmount || 0) : 0;
    const use_deposit = Boolean(rawUseDeposit && deposit_amount > 0);

    if (use_deposit && deposit_amount > 0 && customer_id) {
      const depositData = await this.customersService.getDepositBalance(customer_id);
      if (deposit_amount > depositData.availableDeposit) {
        throw new BadRequestException(
          `Jumlah deposit melebihi saldo deposit pelanggan (Tersedia: Rp ${depositData.availableDeposit.toLocaleString('id-ID')}).`
        );
      }
    }

    const dpPercent = body.dp_percent !== undefined ? body.dp_percent : body.dpPercent;
    const dpAmount = body.dp_amount !== undefined ? body.dp_amount : body.dpAmount;
    const dp_percent = dpPercent !== undefined && dpPercent !== null ? Number(dpPercent) : null;
    const dp_amount = dpAmount !== undefined && dpAmount !== null ? Number(dpAmount) : null;
    const dp_settlement_note = body.dp_settlement_note || body.dpSettlementNote || null;
    const whatsapp_message = body.whatsapp_message || body.whatsappMessage || null;
    const billing_model = body.billing_model || body.billingModel || null;
    const invoice_number = body.invoice_number || body.invoiceNumber || sequence('WTB-INV');
    const invoice_date = body.invoice_date || body.invoiceDate ? new Date(body.invoice_date || body.invoiceDate) : new Date();
    const due_date = body.due_date || body.dueDate ? new Date(body.due_date || body.dueDate) : null;

    const data = await this.prisma.$transaction(async (tx) => {
      if (legacyInvoiceIds.length) {
        await tx.invoice_order.deleteMany({ where: { invoice_id: { in: legacyInvoiceIds } } });
        await tx.invoice.deleteMany({
          where: { id: { in: legacyInvoiceIds }, payments: { none: {} }, refunds: { none: {} } },
        });
      }
      return tx.invoice.create({
        data: {
          invoice_number,
          customer_id: customer_id!,
          invoice_date,
          due_date,
          total_bill,
          deposit_amount,
          use_deposit,
          outstanding_amount: Math.max(0, total_bill - deposit_amount),
          notes: body.notes || null,
          billing_model,
          dp_percent,
          dp_amount,
          dp_settlement_note,
          whatsapp_message,
          orders: { create: orders.map((order) => ({ order_id: order.id, snapshot_amount: order.total_bill })) },
        },
        include: { customer: true, orders: { include: { order: { include: { period: true } } } } },
      });
    });

    await this.invoiceCalcService.refreshInvoicePayment(data.id);
    if (customer_id) {
      await this.customersService.recalculateCustomerDeposit(customer_id);
    }
    await this.prisma.notification.create({
      data: {
        type: 'ORDER',
        title: 'Invoice baru dibuat',
        message: `${data.invoice_number} memuat ${orders.length} pesanan dari ${data.customer.full_name}.`,
        link: `/invoices/${data.id}`,
      },
    });
    return data;
  }

  async update(id: number, body: any) {
    const current = await this.prisma.invoice.findUniqueOrThrow({
      where: { id },
      include: { payments: { where: { deleted_at: null } }, refunds: { where: { deleted_at: null } }, orders: true },
    });

    const customer_id = body.customer_id !== undefined ? Number(body.customer_id) : body.customerId !== undefined ? Number(body.customerId) : current.customer_id;
    const selectedOrderIds = body.order_ids ?? body.orderIds ?? current.orders.map((link) => link.order_id);
    const hasOrderChange = body.order_ids !== undefined || body.orderIds !== undefined || body.customer_id !== undefined || body.customerId !== undefined;

    if (hasOrderChange && (current.payments.length || current.refunds.some((r) => r.status !== 'REJECTED'))) {
      throw new BadRequestException('Komposisi pesanan atau pelanggan tidak dapat diubah setelah invoice memiliki histori transaksi.');
    }

    const rawUseDeposit = body.use_deposit !== undefined ? body.use_deposit : body.useDeposit;
    const rawDepositAmount = body.deposit_amount !== undefined ? body.deposit_amount : body.depositAmount;

    let deposit_amount = Number(current.deposit_amount || 0);
    let use_deposit = current.use_deposit;

    if (rawUseDeposit !== undefined || rawDepositAmount !== undefined) {
      const nextUseDeposit = rawUseDeposit !== undefined ? Boolean(rawUseDeposit) : current.use_deposit;
      const requestedAmount = rawDepositAmount !== undefined ? Number(rawDepositAmount) : Number(current.deposit_amount || 0);
      deposit_amount = nextUseDeposit ? requestedAmount : 0;
      use_deposit = Boolean(nextUseDeposit && deposit_amount > 0);

      if (use_deposit && deposit_amount > 0) {
        const depositData = await this.customersService.getDepositBalance(customer_id, id);
        if (deposit_amount > depositData.availableDeposit) {
          throw new BadRequestException(
            `Jumlah deposit melebihi saldo deposit pelanggan (Tersedia: Rp ${depositData.availableDeposit.toLocaleString('id-ID')}).`
          );
        }
      }
    }

    const dpPercent = body.dp_percent !== undefined ? body.dp_percent : body.dpPercent;
    const dpAmount = body.dp_amount !== undefined ? body.dp_amount : body.dpAmount;
    const dp_percent = dpPercent !== undefined ? (dpPercent !== null ? Number(dpPercent) : null) : undefined;
    const dp_amount = dpAmount !== undefined ? (dpAmount !== null ? Number(dpAmount) : null) : undefined;
    const dp_settlement_note = body.dp_settlement_note !== undefined ? body.dp_settlement_note : body.dpSettlementNote !== undefined ? body.dpSettlementNote : undefined;
    const whatsapp_message = body.whatsapp_message !== undefined ? body.whatsapp_message : body.whatsappMessage;
    const billing_model = body.billing_model !== undefined ? body.billing_model : body.billingModel;
    const invoice_number = body.invoice_number !== undefined ? body.invoice_number : body.invoiceNumber;
    const invoice_date = body.invoice_date !== undefined ? new Date(body.invoice_date) : body.invoiceDate !== undefined ? new Date(body.invoiceDate) : undefined;
    const due_date = body.due_date !== undefined ? (body.due_date ? new Date(body.due_date) : null) : body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : undefined;

    let total_bill = Number(current.total_bill);
    if (hasOrderChange) {
      const orders = await validateInvoiceOrders(this.prisma, customer_id, selectedOrderIds, id);
      total_bill = orders.reduce((sum, order) => sum + Number(order.total_bill), 0);
      const legacyInvoiceIds = extractLegacyInvoiceIds(orders, id);

      await this.prisma.$transaction(async (tx) => {
        if (legacyInvoiceIds.length) {
          await tx.invoice_order.deleteMany({ where: { invoice_id: { in: legacyInvoiceIds } } });
          await tx.invoice.deleteMany({
            where: { id: { in: legacyInvoiceIds }, payments: { none: {} }, refunds: { none: {} } },
          });
        }
        await tx.invoice_order.deleteMany({ where: { invoice_id: id } });
        await tx.invoice_order.createMany({
          data: orders.map((order) => ({ invoice_id: id, order_id: order.id, snapshot_amount: order.total_bill })),
        });
        await tx.invoice.update({
          where: { id },
          data: {
            customer_id,
            invoice_number,
            invoice_date,
            due_date,
            notes: body.notes,
            billing_model,
            dp_percent,
            dp_amount,
            dp_settlement_note,
            whatsapp_message,
            total_bill,
            deposit_amount,
            use_deposit,
          },
        });
      });
    } else {
      await this.prisma.invoice.update({
        where: { id },
        data: {
          customer_id,
          invoice_number,
          invoice_date,
          due_date,
          notes: body.notes,
          billing_model,
          dp_percent,
          dp_amount,
          dp_settlement_note,
          whatsapp_message,
          deposit_amount,
          use_deposit,
        },
      });
    }

    const refreshed = await this.invoiceCalcService.refreshInvoicePayment(id);
    await this.customersService.recalculateCustomerDeposit(customer_id);
    return refreshed;
  }

  async remove(id: number, user_id?: number) {
    const current = await this.prisma.invoice.findUniqueOrThrow({ where: { id } });
    await this.prisma.invoice.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });
    await this.customersService.recalculateCustomerDeposit(current.customer_id);
    return { success: true };
  }
}
