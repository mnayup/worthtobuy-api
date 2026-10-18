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

  async getUnpackedInvoiceOptions(customerId: number) {
    if (!customerId) return [];

    // Find active (non-deleted) invoices for this customer
    const invoices = await this.prisma.invoice.findMany({
      where: {
        customer_id: customerId,
        deleted_at: null,
      },
      include: {
        orders: {
          include: {
            order: {
              include: {
                shipments: true,
                items: true,
              },
            },
          },
        },
      },
      orderBy: { invoice_date: 'desc' },
    });

    const eligibleInvoices: any[] = [];

    for (const inv of invoices) {
      if (!inv.orders || inv.orders.length === 0) continue;

      let isPackedOrBeyond = false;
      let hasKeepItems = false;

      for (const link of inv.orders) {
        const order = link.order;
        if (!order) continue;

        // Check if shipment is packed or beyond
        if (order.shipments && order.shipments.length > 0) {
          for (const s of order.shipments) {
            if (['PACKED', 'READY', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'DELIVERED'].includes(s.status) || s.packed_at) {
              isPackedOrBeyond = true;
              break;
            }
          }
        }

        // Check if order status is already shipped or completed
        if (['SHIPPED', 'COMPLETED'].includes(order.status)) {
          isPackedOrBeyond = true;
        }

        // Check if any order item has keep / titip (kept_until set or fulfillment_status === 'KEPT')
        if (order.items && order.items.length > 0) {
          for (const item of order.items) {
            if (item.kept_until || item.fulfillment_status === 'KEPT') {
              hasKeepItems = true;
              break;
            }
          }
        }

        if (isPackedOrBeyond || hasKeepItems) break;
      }

      // If already packed, cannot add new order into it.
      // If previous invoice items are keep / titip, mandatory to create new invoice (different batas waktu titip).
      if (!isPackedOrBeyond && !hasKeepItems) {
        eligibleInvoices.push({
          id: inv.id,
          invoice_number: inv.invoice_number,
          invoice_date: inv.invoice_date,
          status: inv.status,
          total_bill: Number(inv.total_bill),
          outstanding_amount: Number(inv.outstanding_amount),
          order_count: inv.orders.length,
          order_numbers: inv.orders.map((o) => o.order.order_number).join(', '),
        });
      }
    }

    return eligibleInvoices;
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

  async bulkIssue(body: any, userId?: number) {
    const rawOrderIds: any[] = body.order_ids ?? body.orderIds ?? [];
    const orderIds = rawOrderIds.map(Number).filter((id) => !isNaN(id) && id > 0);
    if (!orderIds.length) {
      throw new BadRequestException('Pilih setidaknya satu pesanan untuk menerbitkan invoice.');
    }

    const billingModel = body.billing_model || body.billingModel || 'FULL_PAYMENT';
    const dpPercent = billingModel === 'DP' ? Number(body.dp_percent ?? body.dpPercent ?? 50) : null;

    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds }, deleted_at: null },
      include: {
        customer: true,
        invoice_links: {
          include: {
            invoice: {
              include: { payments: true, refunds: true },
            },
          },
        },
      },
    });

    if (!orders.length) {
      throw new BadRequestException('Pesanan yang dipilih tidak ditemukan.');
    }

    const validOrders: typeof orders = [];
    const skippedOrders: { orderNumber: string; reason: string }[] = [];

    for (const order of orders) {
      if (order.status !== 'NEW') {
        skippedOrders.push({
          orderNumber: order.order_number,
          reason: `Status pesanan bukan NEW (${order.status})`,
        });
        continue;
      }

      const activeLink = order.invoice_links.find((link) => {
        const isLegacyReplaceable =
          link.invoice.invoice_number.startsWith('WTB-LEGACY-') &&
          link.invoice.payments.length === 0 &&
          link.invoice.refunds.length === 0;
        return !isLegacyReplaceable;
      });

      if (activeLink) {
        skippedOrders.push({
          orderNumber: order.order_number,
          reason: `Sudah terhubung ke invoice ${activeLink.invoice.invoice_number}`,
        });
      } else {
        validOrders.push(order);
      }
    }

    if (!validOrders.length) {
      throw new BadRequestException(
        `Tidak ada pesanan berstatus NEW yang dapat diterbitkan: ${skippedOrders.map((s) => `${s.orderNumber} (${s.reason})`).join(', ')}`
      );
    }

    const customerOrderGroups = new Map<number, typeof orders>();
    for (const order of validOrders) {
      const list = customerOrderGroups.get(order.customer_id) || [];
      list.push(order);
      customerOrderGroups.set(order.customer_id, list);
    }

    const createdInvoices: any[] = [];
    const today = new Date();

    const useExistingInvoice = Boolean(body.use_existing_invoice ?? body.useExistingInvoice);
    const customerInvoiceMap = body.customer_invoice_map ?? body.customerInvoiceMap ?? {};

    for (const [customerId, custOrders] of customerOrderGroups.entries()) {
      const total_bill = custOrders.reduce((sum, o) => sum + Number(o.total_bill || 0), 0);
      const dp_amount = billingModel === 'DP' && dpPercent ? Math.round((total_bill * dpPercent) / 100) : null;
      const legacyInvoiceIds = extractLegacyInvoiceIds(custOrders);

      // Check if user chose to use an existing invoice for this customer or overall
      const requestedInvId = customerInvoiceMap[customerId] ? Number(customerInvoiceMap[customerId]) : null;
      let targetExistingInvoice: any = null;

      if (useExistingInvoice || requestedInvId) {
        // Query unpacked invoices for this customer that do NOT have packed items and do NOT have keep items
        const eligibleInvoices = await this.getUnpackedInvoiceOptions(customerId);
        if (requestedInvId) {
          targetExistingInvoice = eligibleInvoices.find((inv) => inv.id === requestedInvId);
        } else if (useExistingInvoice && eligibleInvoices.length > 0) {
          targetExistingInvoice = eligibleInvoices[0];
        }
        // Note: If previous order is on keep, eligibleInvoices will be empty for that invoice,
        // so targetExistingInvoice remains null and a new invoice is created as required!
      }

      if (targetExistingInvoice) {
        // Append orders into existing unpacked invoice
        const invId = targetExistingInvoice.id;
        await this.prisma.$transaction(async (tx) => {
          if (legacyInvoiceIds.length) {
            await tx.invoice_order.deleteMany({ where: { invoice_id: { in: legacyInvoiceIds } } });
            await tx.invoice.deleteMany({
              where: { id: { in: legacyInvoiceIds }, payments: { none: {} }, refunds: { none: {} } },
            });
          }

          // Create invoice_order link for each order
          for (const o of custOrders) {
            await tx.invoice_order.create({
              data: {
                invoice_id: invId,
                order_id: o.id,
                snapshot_amount: o.total_bill,
              },
            });
          }
        });

        await this.invoiceCalcService.refreshInvoicePayment(invId);
        await this.prisma.notification.create({
          data: {
            type: 'ORDER',
            title: 'Pesanan ditambahkan ke invoice yang sudah ada (Bulk)',
            message: `${targetExistingInvoice.invoice_number} ditambahkan ${custOrders.length} pesanan baru.`,
            link: `/invoices/${invId}`,
          },
        });

        createdInvoices.push({
          id: invId,
          invoice_number: targetExistingInvoice.invoice_number,
          appended: true,
        });
      } else {
        // Create new invoice
        const invoiceNumber = sequence('WTB-INV');
        const inv = await this.prisma.$transaction(async (tx) => {
          if (legacyInvoiceIds.length) {
            await tx.invoice_order.deleteMany({ where: { invoice_id: { in: legacyInvoiceIds } } });
            await tx.invoice.deleteMany({
              where: { id: { in: legacyInvoiceIds }, payments: { none: {} }, refunds: { none: {} } },
            });
          }

          return tx.invoice.create({
            data: {
              invoice_number: invoiceNumber,
              customer_id: customerId,
              invoice_date: today,
              due_date: today,
              total_bill,
              deposit_amount: 0,
              use_deposit: false,
              outstanding_amount: total_bill,
              notes: null,
              billing_model: billingModel,
              dp_percent: dpPercent,
              dp_amount: dp_amount,
              dp_settlement_note: billingModel === 'DP' ? 'when products are ready to ship' : null,
              orders: {
                create: custOrders.map((o) => ({
                  order_id: o.id,
                  snapshot_amount: o.total_bill,
                })),
              },
            },
            include: {
              customer: true,
              orders: { include: { order: true } },
            },
          });
        });

        await this.invoiceCalcService.refreshInvoicePayment(inv.id);
        await this.prisma.notification.create({
          data: {
            type: 'ORDER',
            title: 'Invoice baru dibuat (Bulk)',
            message: `${inv.invoice_number} memuat ${custOrders.length} pesanan dari ${inv.customer.full_name}.`,
            link: `/invoices/${inv.id}`,
          },
        });

        createdInvoices.push(inv);
      }
    }

    return {
      count: createdInvoices.length,
      invoiceIds: createdInvoices.map((i) => i.id),
      invoices: createdInvoices,
      skipped: skippedOrders,
    };
  }

  async update(id: number, body: any) {
    const current = await this.prisma.invoice.findUniqueOrThrow({
      where: { id },
      include: { payments: { where: { deleted_at: null } }, refunds: { where: { deleted_at: null } }, orders: true },
    });

    const customer_id = body.customer_id !== undefined ? Number(body.customer_id) : body.customerId !== undefined ? Number(body.customerId) : current.customer_id;
    const selectedOrderIds = body.order_ids ?? body.orderIds ?? current.orders.map((link) => link.order_id);
    const hasOrderChange = body.order_ids !== undefined || body.orderIds !== undefined || body.customer_id !== undefined || body.customerId !== undefined;

    if (hasOrderChange) {
      // Check if invoice or any order is already packed
      const invoiceShipments = await this.prisma.shipment.findMany({
        where: { order_id: { in: current.orders.map((o) => o.order_id) } },
      });
      const isPacked = invoiceShipments.some((s) =>
        ['PACKED', 'READY', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'DELIVERED'].includes(s.status) || Boolean(s.packed_at)
      );
      if (isPacked) {
        throw new BadRequestException('Pesanan tidak dapat diubah atau ditambahkan karena invoice / pesanan sudah dalam proses packing atau pengiriman.');
      }

      // Customer change is never allowed once transactions exist
      if (customer_id !== current.customer_id && (current.payments.length || current.refunds.some((r) => r.status !== 'REJECTED'))) {
        throw new BadRequestException('Pelanggan tidak dapat diubah setelah invoice memiliki histori transaksi.');
      }

      // Removal of existing orders is not allowed once transactions exist, but appending new orders is permitted!
      const currentOrderIds = new Set(current.orders.map((l) => l.order_id));
      const removedOrders = Array.from(currentOrderIds).filter((id) => !selectedOrderIds.includes(id));
      if (removedOrders.length > 0 && (current.payments.length || current.refunds.some((r) => r.status !== 'REJECTED'))) {
        throw new BadRequestException('Pesanan yang sudah memiliki transaksi pembayaran tidak dapat dihapus dari invoice.');
      }
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

    const rawKeepItems = body.keep_items !== undefined ? body.keep_items : body.keepItems;
    if (rawKeepItems !== undefined) {
      const isKeep = Boolean(rawKeepItems);
      const rawKeptUntil = body.kept_until !== undefined ? body.kept_until : body.keptUntil;
      const keptUntil = isKeep
        ? (rawKeptUntil ? new Date(rawKeptUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
        : null;

      const invOrders = await this.prisma.invoice_order.findMany({
        where: { invoice_id: id },
        select: { order_id: true },
      });
      const orderIds = invOrders.map((o) => o.order_id);
      if (orderIds.length > 0) {
        await this.prisma.order_item.updateMany({
          where: { order_id: { in: orderIds } },
          data: { kept_until: keptUntil },
        });

        if (isKeep) {
          await this.prisma.order_item.updateMany({
            where: {
              order_id: { in: orderIds },
              fulfillment_status: 'AVAILABLE',
            },
            data: { fulfillment_status: 'KEPT' },
          });
        } else {
          await this.prisma.order_item.updateMany({
            where: {
              order_id: { in: orderIds },
              fulfillment_status: 'KEPT',
            },
            data: { fulfillment_status: 'AVAILABLE' },
          });
        }
      }
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
