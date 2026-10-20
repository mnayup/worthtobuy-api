import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { sequence } from '../../common/utils/http.utils';

const normalizeWhatsapp = (value: string) => value.replace(/\D/g, '').replace(/^0/, '62');

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) { }

  private async ensureNoDuplicate(input: { whatsapp?: string; email?: string | null; customer_code?: string }, excludeId?: number) {
    const whatsapp = input.whatsapp ? normalizeWhatsapp(input.whatsapp) : undefined;
    const conditions: any[] = [];
    if (whatsapp) conditions.push({ whatsapp });
    if (input.email) conditions.push({ email: { equals: input.email, mode: 'insensitive' } });
    if (input.customer_code) conditions.push({ customer_code: { equals: input.customer_code, mode: 'insensitive' } });
    if (!conditions.length) return;
    const duplicate = await this.prisma.customer.findFirst({
      where: { ...(excludeId ? { id: { not: excludeId } } : {}), OR: conditions },
    });
    if (duplicate) {
      throw new ConflictException(`Pelanggan berpotensi duplikat dengan ${duplicate.customer_code} • ${duplicate.full_name}. Periksa WhatsApp, email, atau ID pelanggan.`);
    }
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim().slice(0, 100);
    const segment = query.segment && query.segment !== 'ALL' ? String(query.segment) : undefined;
    const status = query.status && query.status !== 'ALL' ? String(query.status) : undefined;
    const city = query.city && query.city !== 'ALL' ? String(query.city) : undefined;
    const whatsappGroupIdRaw = query.whatsappGroupId ?? query.whatsapp_group_id;
    const whatsappGroupId =
      whatsappGroupIdRaw && whatsappGroupIdRaw !== 'ALL'
        ? Number(whatsappGroupIdRaw)
        : undefined;

    const where: any = {
      deleted_at: null,
      ...(segment ? { segment } : {}),
      ...(status ? { status } : {}),
      ...(whatsappGroupId ? { whatsapp_group_id: whatsappGroupId } : {}),
      ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
      ...(search
        ? {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { whatsapp: { contains: search } },
            { customer_code: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } },
            { postal_code: { contains: search, mode: 'insensitive' } },
            { social_username: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
          ],
        }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          _count: { select: { orders: true } },
          whatsapp_group: { select: { id: true, name: true, url: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOverview(id: number) {
    const [customer, refunds, orderCount, invoiceSummary, shipmentCount, paidRefundSummary] = await Promise.all([
      this.prisma.customer.findFirstOrThrow({
        where: { id, deleted_at: null },
        include: {
          whatsapp_group: true,
          orders: {
            where: { deleted_at: null },
            orderBy: { order_date: 'desc' },
            take: 50,
            include: { period: true, items: { include: { product: true } }, shipments: true, invoice_links: { include: { invoice: true } } },
          },
          invoices: {
            where: { deleted_at: null },
            orderBy: { invoice_date: 'desc' },
            take: 50,
            include: { orders: { include: { order: { include: { period: true } } } }, payments: { where: { deleted_at: null } }, refunds: { where: { deleted_at: null } } },
          },
          shipments: { where: { order: { deleted_at: null } }, orderBy: { created_at: 'desc' }, take: 50, include: { order: true } },
        },
      }),
      this.prisma.refund.findMany({
        where: { deleted_at: null, OR: [{ order: { customer_id: id, deleted_at: null } }, { invoice: { customer_id: id, deleted_at: null } }] },
        orderBy: { created_at: 'desc' },
        take: 50,
        include: { order: true, invoice: true },
      }),
      this.prisma.order.count({ where: { customer_id: id, deleted_at: null } }),
      this.prisma.invoice.aggregate({
        where: { customer_id: id, deleted_at: null },
        _count: { _all: true },
        _sum: { total_bill: true, paid_amount: true, outstanding_amount: true },
      }),
      this.prisma.shipment.count({ where: { customer_id: id, order: { deleted_at: null } } }),
      this.prisma.refund.aggregate({
        where: { deleted_at: null, status: 'PAID', OR: [{ order: { customer_id: id, deleted_at: null } }, { invoice: { customer_id: id, deleted_at: null } }] },
        _sum: { amount: true },
      }),
    ]);

    const depositData = await this.getDepositBalance(id);

    const summary = {
      totalOrders: orderCount,
      totalInvoices: invoiceSummary._count._all,
      omzet: invoiceSummary._sum.total_bill || 0,
      paid: invoiceSummary._sum.paid_amount || 0,
      outstanding: invoiceSummary._sum.outstanding_amount || 0,
      totalRefund: paidRefundSummary._sum.amount || 0,
      totalShipments: shipmentCount,
      deposit_balance: depositData.availableDeposit,
      totalDeposits: depositData.totalDeposits,
      totalDepositUsed: depositData.totalUsed,
    };

    return { customer, refunds, summary, deposit: depositData };
  }

  async getDepositBalance(customer_id: number, excludeInvoiceId?: number) {
    const [paidDeposits, usedInvoices] = await Promise.all([
      this.prisma.refund.findMany({
        where: {
          deleted_at: null,
          status: 'PAID',
          refund_type: 'CUSTOMER_DEPOSIT',
          OR: [
            { customer_id },
            { order: { customer_id, deleted_at: null } },
            { invoice: { customer_id, deleted_at: null } },
          ],
        },
        select: { id: true, refund_number: true, amount: true, refunded_at: true, reason: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          customer_id,
          deleted_at: null,
          status: { not: 'CANCELLED' },
          deposit_amount: { gt: 0 },
          ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
        },
        select: { id: true, invoice_number: true, deposit_amount: true },
      }),
    ]);

    const totalDeposits = paidDeposits.reduce((sum, r) => sum + Number(r.amount), 0);
    const totalUsed = usedInvoices.reduce((sum, inv) => sum + Number(inv.deposit_amount), 0);
    const availableDeposit = Math.max(0, totalDeposits - totalUsed);

    return {
      customer_id,
      availableDeposit,
      totalDeposits,
      totalUsed,
      depositHistory: paidDeposits,
      usedInvoices,
    };
  }

  async recalculateCustomerDeposit(customer_id: number) {
    const { availableDeposit } = await this.getDepositBalance(customer_id);
    await this.prisma.customer.update({
      where: { id: customer_id },
      data: { deposit_balance: availableDeposit },
    });
    return availableDeposit;
  }

  async findOne(id: number) {
    return this.prisma.customer.findFirstOrThrow({
      where: { id, deleted_at: null },
      include: {
        whatsapp_group: true,
        orders: {
          where: { deleted_at: null },
          include: { payments: { where: { deleted_at: null } }, shipments: true },
          orderBy: { order_date: 'desc' },
        },
      },
    });
  }

  private cleanCustomerData(body: any) {
    const full_name = body.full_name !== undefined ? body.full_name : body.fullName;
    const customer_code = body.customer_code !== undefined ? body.customer_code : body.customerCode;
    const postal_code = body.postal_code !== undefined ? body.postal_code : body.postalCode;
    const social_username = body.social_username !== undefined ? body.social_username : body.socialUsername;
    const deposit_balance = body.deposit_balance !== undefined ? body.deposit_balance : body.depositBalance;
    const whatsapp_group_id = body.whatsapp_group_id !== undefined ? body.whatsapp_group_id : body.whatsappGroupId;

    const data: any = {};
    if (full_name !== undefined) data.full_name = String(full_name).trim();
    if (customer_code !== undefined) data.customer_code = String(customer_code).trim();
    if (body.whatsapp !== undefined) data.whatsapp = normalizeWhatsapp(String(body.whatsapp || ''));
    if (body.email !== undefined) data.email = body.email ? String(body.email).toLowerCase().trim() : null;
    if (body.address !== undefined) data.address = body.address ? String(body.address).trim() : null;
    if (body.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (postal_code !== undefined) data.postal_code = postal_code ? String(postal_code).trim() : null;
    if (social_username !== undefined) data.social_username = social_username ? String(social_username).trim() : null;
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;
    if (body.segment !== undefined) data.segment = body.segment;
    if (body.status !== undefined) data.status = typeof body.status === 'boolean' ? (body.status ? 'active' : 'inactive') : String(body.status);
    if (deposit_balance !== undefined) data.deposit_balance = Number(deposit_balance || 0);
    if (whatsapp_group_id !== undefined) {
      data.whatsapp_group_id =
        whatsapp_group_id && Number(whatsapp_group_id) > 0 ? Number(whatsapp_group_id) : null;
    }

    return data;
  }

  async create(body: any, user_id?: number) {
    const data = this.cleanCustomerData(body);
    if (!data.customer_code) data.customer_code = sequence('CUS');
    await this.ensureNoDuplicate(data);
    return this.prisma.customer.create({ data });
  }

  async update(id: number, body: any, user_id?: number) {
    const data = this.cleanCustomerData(body);
    await this.ensureNoDuplicate(data, id);
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(id: number, user_id?: number) {
    return this.prisma.customer.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });
  }
}
