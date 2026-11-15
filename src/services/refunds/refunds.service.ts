import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { CustomersService } from '../customers/customers.service';
import { sequence } from '../../common/utils/http.utils';
import {
  cleanRefundData,
  buildRefundWhereClause,
  sortRefundRows,
  resolveRefundTargets,
  shouldValidateDepositRelease,
  buildRefundUpdatePayload,
} from './helpers/refund-data.helper';

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceCalcService: InvoiceCalcService,
    private readonly customersService: CustomersService,
  ) { }

  async getSummary() {
    const counts = await this.prisma.refund.groupBy({
      by: ['status'],
      where: {
        deleted_at: null,
        OR: [{ order: { deleted_at: null } }, { invoice: { deleted_at: null } }, { customer: { deleted_at: null } }],
      },
      _count: { id: true },
    });
    const total = await this.prisma.refund.count({
      where: {
        deleted_at: null,
        OR: [{ order: { deleted_at: null } }, { invoice: { deleted_at: null } }, { customer: { deleted_at: null } }],
      },
    });
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
    const where = buildRefundWhereClause(query);

    const [rawRows, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        include: {
          order: { include: { customer: true } },
          invoice: { include: { customer: true } },
          customer: true,
        },
      }),
      this.prisma.refund.count({ where }),
    ]);

    const sorted = sortRefundRows(rawRows);
    const data = sorted.slice(skip, skip + limit);

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
    const refunded_at =
      cleaned.refunded_at ?? (cleaned.status === 'PAID' ? new Date() : undefined);

    const data = await this.prisma.refund.create({
      data: {
        ...cleaned,
        order_id: resolvedOrderId,
        invoice_id: resolvedInvoiceId,
        customer_id,
        refund_type,
        ...(refunded_at !== undefined ? { refunded_at } : {}),
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

  private async assertDepositCanBeReleased(current: any, cleaned: any, customerId: number | null) {
    if (!customerId || !shouldValidateDepositRelease(current, cleaned)) {
      return;
    }
    const balance = await this.customersService.getDepositBalance(customerId);
    if (balance.availableDeposit < Number(current.amount)) {
      throw new BadRequestException(
        `Sebagian saldo deposit (${current.refund_number}) telah terpakai pada invoice aktif pelanggan. Batalkan pemakaian deposit di invoice terlebih dahulu.`
      );
    }
  }

  private async syncRefundSideEffects(
    current: any,
    data: any,
    cleaned: any,
    customerId: number | null
  ) {
    if (cleaned.status === 'PAID' && data.order_id) {
      await this.prisma.order.update({ where: { id: data.order_id }, data: { status: 'REFUND' } });
    }
    if (current.invoice_id && current.invoice_id !== data.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(current.invoice_id);
    }
    if (data.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(data.invoice_id);
    }
    if (customerId) {
      await this.customersService.recalculateCustomerDeposit(customerId);
    }
  }

  async update(id: number, body: any) {
    const current = await this.prisma.refund.findUniqueOrThrow({
      where: { id },
      include: { order: true, invoice: true },
    });
    const cleaned = cleanRefundData(body);
    const targets = resolveRefundTargets(current, cleaned);

    if (!targets.resolvedOrderId && !targets.resolvedInvoiceId && !targets.customerId) {
      throw new BadRequestException('Pilih minimal satu target refund: pelanggan, invoice, atau pesanan.');
    }

    await this.assertDepositCanBeReleased(current, cleaned, targets.customerId);

    if (current.auto_generated && !body.is_processing && !body.status && cleaned.amount !== undefined) {
      throw new BadRequestException('Refund yang dibuat otomatis oleh sistem tidak dapat diubah secara manual.');
    }

    const updateData = buildRefundUpdatePayload(current, cleaned, targets);
    const data = await this.prisma.refund.update({
      where: { id },
      data: updateData,
      include: { customer: true, invoice: { include: { customer: true } }, order: { include: { customer: true } } },
    });

    await this.syncRefundSideEffects(current, data, cleaned, targets.customerId);
    return data;
  }

  async processRefund(id: number, body: {
    refund_type?: 'CUSTOMER_DEPOSIT' | 'DIRECT_TRANSFER';
    refundType?: 'CUSTOMER_DEPOSIT' | 'DIRECT_TRANSFER';
    notes?: string;
    refunded_at?: any;
    refundedAt?: any;
    bank_name?: string;
    bankName?: string;
    account_number?: string;
    accountNumber?: string;
    account_holder?: string;
    accountHolder?: string;
    proof_url?: string;
    proofUrl?: string;
    transfer_notes?: string;
    transferNotes?: string;
  }) {
    const current = await this.prisma.refund.findUniqueOrThrow({ where: { id } });
    const refund_type = body.refund_type || body.refundType || current.refund_type || 'DIRECT_TRANSFER';
    const proof_url = body.proof_url ?? body.proofUrl ?? current.proof_url;

    if (refund_type === 'DIRECT_TRANSFER' && !proof_url) {
      throw new BadRequestException('Bukti transfer wajib diunggah untuk transfer balik rekening.');
    }

    return this.update(id, {
      status: 'PAID',
      refund_type,
      notes: body.notes,
      refunded_at: body.refunded_at || body.refundedAt || new Date(),
      bank_name: body.bank_name ?? body.bankName,
      account_number: body.account_number ?? body.accountNumber,
      account_holder: body.account_holder ?? body.accountHolder,
      proof_url,
      transfer_notes: body.transfer_notes ?? body.transferNotes,
    });
  }

  async rejectRefund(id: number, reason?: string) {
    const current = await this.prisma.refund.findUniqueOrThrow({
      where: { id },
      include: { order: true, invoice: true },
    });

    if (current.status === 'PAID') {
      throw new BadRequestException('Refund yang sudah selesai/PAID tidak dapat ditolak.');
    }
    if (current.status === 'REJECTED') {
      return current;
    }

    return this.update(id, {
      status: 'REJECTED',
      notes: reason ? reason.trim() : (current.notes || 'Ditolak oleh admin/owner.'),
    });
  }

  /**
   * Delete a finished refund (PAID or REJECTED only).
   *
   * Financial effects are recalculated from source data, never patched manually:
   * - PAID + CUSTOMER_DEPOSIT → customer's deposit balance is reduced by the refund amount.
   *   Blocked when that deposit has already been consumed by invoices (balance would go negative).
   * - PAID + MANUAL source → invoice paid_amount is restored (manual refunds deduct paid amount).
   * - PAID + OVERPAYMENT source → the overpayment re-opens and the system re-raises a fresh
   *   REQUESTED refund, so no customer money is silently lost.
   * - REJECTED → no money effect; the record is only removed from the list.
   *
   * Auto-generated refunds keep their source_key as a tombstone so the auto-refund engine
   * does not resurrect an item/shipping refund that admin explicitly removed.
   */
  async remove(id: number, user_id?: number, confirmation?: string) {
    const current = await this.prisma.refund.findFirst({
      where: { id, deleted_at: null },
      include: { order: true, invoice: true },
    });
    if (!current) {
      throw new BadRequestException('Data refund tidak ditemukan atau sudah dihapus.');
    }

    if (!['PAID', 'REJECTED'].includes(current.status)) {
      throw new BadRequestException(
        'Hanya refund berstatus PAID atau REJECTED yang dapat dihapus. Selesaikan atau tolak refund terlebih dahulu.'
      );
    }

    if (String(confirmation ?? '').trim() !== current.refund_number) {
      throw new BadRequestException(
        `Konfirmasi tidak cocok. Ketik "${current.refund_number}" untuk menghapus refund ini.`
      );
    }

    const customer_id =
      current.customer_id || current.order?.customer_id || current.invoice?.customer_id || null;

    const isPaidDeposit = current.status === 'PAID' && current.refund_type === 'CUSTOMER_DEPOSIT';
    if (isPaidDeposit && customer_id) {
      const balance = await this.customersService.getDepositBalance(customer_id);
      const amount = Number(current.amount || 0);
      if (balance.availableDeposit < amount) {
        const usedOn = balance.usedInvoices.map((inv: any) => inv.invoice_number).join(', ');
        throw new BadRequestException(
          `Saldo deposit pelanggan tidak cukup untuk dikurangi (Tersedia: Rp ${balance.availableDeposit.toLocaleString('id-ID')}, ` +
          `refund: Rp ${amount.toLocaleString('id-ID')}). Deposit sudah terpakai pada invoice: ${usedOn || '-'}. ` +
          'Batalkan pemakaian deposit di invoice tersebut terlebih dahulu.'
        );
      }
    }

    await this.prisma.refund.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });

    // Revert order status flag set when this refund was paid, if no other paid refund remains
    if (current.status === 'PAID' && current.order_id && current.order?.status === 'REFUND') {
      await this.restoreOrderStatusAfterRefundRemoval(current.order_id);
    }

    if (current.invoice_id) {
      await this.invoiceCalcService.refreshInvoicePayment(current.invoice_id);
    }
    if (customer_id) {
      await this.customersService.recalculateCustomerDeposit(customer_id);
    }
    return { success: true, refund_number: current.refund_number };
  }

  private async restoreOrderStatusAfterRefundRemoval(order_id: number) {
    const otherPaid = await this.prisma.refund.count({
      where: { order_id, deleted_at: null, status: 'PAID' },
    });
    if (otherPaid > 0) return;

    const items = await this.prisma.order_item.findMany({
      where: { order_id },
      select: { fulfillment_status: true },
    });
    const statuses = items.map((item) => item.fulfillment_status as string);
    let status: any = 'WAITING_PURCHASE';
    if (!statuses.length) status = 'WAITING_PURCHASE';
    else if (statuses.every((v) => v === 'DELIVERED')) status = 'COMPLETED';
    else if (statuses.every((v) => ['SHIPPED', 'DELIVERED'].includes(v))) status = 'SHIPPED';
    else if (statuses.every((v) => v === 'UNAVAILABLE')) status = 'UNAVAILABLE';
    else if (statuses.some((v) => v === 'KEPT')) status = 'PURCHASED';
    else if (statuses.every((v) => ['AVAILABLE', 'READY_TO_SHIP', 'UNAVAILABLE'].includes(v))) status = 'READY_TO_SHIP';
    else if (statuses.some((v) => v === 'AVAILABLE')) status = 'PURCHASED';
    else if (statuses.some((v) => v === 'SEARCHING')) status = 'SEARCHING';

    await this.prisma.order.update({ where: { id: order_id }, data: { status } });
  }
}
