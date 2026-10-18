import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { UploadsService } from '../uploads/uploads.service';

type EntityType = 'USER' | 'CUSTOMER' | 'PERIOD' | 'PRODUCT' | 'ORDER' | 'PAYMENT' | 'EXPENSE' | 'REFUND' | 'INVOICE' | 'SHIPPING_COUNTER';

@Injectable()
export class TrashService {
  constructor(
    private prisma: PrismaService,
    private invoiceCalcService: InvoiceCalcService,
    private uploadsService: UploadsService,
  ) { }

  private getDelegate(entity: EntityType): any {
    const delegates: Record<EntityType, any> = {
      USER: this.prisma.user,
      CUSTOMER: this.prisma.customer,
      PERIOD: this.prisma.jastip_period,
      PRODUCT: this.prisma.product,
      ORDER: this.prisma.order,
      PAYMENT: this.prisma.payment,
      EXPENSE: this.prisma.expense,
      REFUND: this.prisma.refund,
      INVOICE: this.prisma.invoice,
      SHIPPING_COUNTER: this.prisma.shipping_counter,
    };
    return delegates[entity];
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim().toLowerCase().slice(0, 100);
    const requestedType = String(query.type || '').trim().toUpperCase();

    const [users, customers, periods, products, orders, payments, expenses, refunds, invoices, shippingCounters] = await Promise.all([
      this.prisma.user.findMany({ where: { deleted_at: { not: null } }, include: { role: true } }),
      this.prisma.customer.findMany({ where: { deleted_at: { not: null } } }),
      this.prisma.jastip_period.findMany({ where: { deleted_at: { not: null } } }),
      this.prisma.product.findMany({ where: { deleted_at: { not: null } } }),
      this.prisma.order.findMany({ where: { deleted_at: { not: null } }, include: { customer: true, period: true } }),
      this.prisma.payment.findMany({ where: { deleted_at: { not: null } }, include: { invoice: true, order: true } }),
      this.prisma.expense.findMany({ where: { deleted_at: { not: null } }, include: { period: true } }),
      this.prisma.refund.findMany({ where: { deleted_at: { not: null } }, include: { invoice: true, order: true } }),
      this.prisma.invoice.findMany({ where: { deleted_at: { not: null } }, include: { customer: true } }),
      this.prisma.shipping_counter.findMany({ where: { deleted_at: { not: null } } }),
    ]);

    const all = [
      ...users.map((x: any) => ({ entityType: 'USER', id: x.id, code: x.email, name: `${x.name} • ${x.role?.name || '-'}`, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...customers.map((x: any) => ({ entityType: 'CUSTOMER', id: x.id, code: x.customer_code, name: x.full_name, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...periods.map((x: any) => ({ entityType: 'PERIOD', id: x.id, code: x.code, name: x.name, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...products.map((x: any) => ({ entityType: 'PRODUCT', id: x.id, code: x.sku, name: x.name, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...orders.map((x: any) => ({ entityType: 'ORDER', id: x.id, code: x.order_number, name: `${x.customer?.full_name || '-'} • ${x.period?.code || '-'}`, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...payments.map((x: any) => ({ entityType: 'PAYMENT', id: x.id, code: x.payment_number, name: `${x.invoice?.invoice_number || x.order?.order_number || '-'} • Rp${Number(x.amount).toLocaleString('id-ID')}`, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...expenses.map((x: any) => ({ entityType: 'EXPENSE', id: x.id, code: x.expense_number, name: `${x.category} • Rp${Number(x.amount_idr).toLocaleString('id-ID')}`, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...refunds.map((x: any) => ({ entityType: 'REFUND', id: x.id, code: x.refund_number, name: `${x.invoice?.invoice_number || x.order?.order_number || '-'} • Rp${Number(x.amount).toLocaleString('id-ID')}`, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...invoices.map((x: any) => ({ entityType: 'INVOICE', id: x.id, code: x.invoice_number, name: `${x.customer?.full_name || '-'} • Rp${Number(x.total_bill).toLocaleString('id-ID')}`, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
      ...shippingCounters.map((x: any) => ({ entityType: 'SHIPPING_COUNTER', id: x.id, code: x.code || x.courier, name: `${x.name} (${x.courier})`, deleted_at: x.deleted_at, deleted_by_id: x.deleted_by_id })),
    ].sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());

    const userIds = [...new Set(all.map(x => x.deleted_by_id).filter(Boolean))];
    const deleters = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(deleters.map((x: any) => [x.id, x.name]));
    const enriched = all.map(x => ({ ...x, deletedByName: names.get(x.deleted_by_id) || '-' }));

    const filtered = enriched.filter((row: any) => {
      if (requestedType && row.entityType !== requestedType) return false;
      if (!search) return true;
      return `${row.entityType} ${row.code || ''} ${row.name || ''} ${row.deletedByName || ''}`.toLowerCase().includes(search);
    });

    const counts = {
      all: enriched.length,
      invoice: enriched.filter((row: any) => row.entityType === 'INVOICE').length,
      transaction: enriched.filter((row: any) => !['INVOICE', 'USER', 'CUSTOMER', 'PERIOD', 'PRODUCT'].includes(row.entityType)).length,
    };

    return { data: filtered.slice(skip, skip + limit), total: filtered.length, page, limit, counts };
  }

  async restore(entity: EntityType, id: number) {
    const delegate = this.getDelegate(entity);
    const data = await delegate.update({
      where: { id },
      data: { deleted_at: null, deleted_by_id: null, ...(entity === 'USER' ? { is_active: true } : {}) },
    });

    if (entity === 'PAYMENT') {
      const activeInvoice = data.invoice_id ? await this.prisma.invoice.findFirst({ where: { id: data.invoice_id, deleted_at: null } }) : null;
      const activeOrder = data.order_id ? await this.prisma.order.findFirst({ where: { id: data.order_id, deleted_at: null } }) : null;
      if (activeInvoice || activeOrder) await this.invoiceCalcService.refreshPaymentTarget(data);
    }
    if (entity === 'REFUND' && data.invoice_id) {
      const activeInvoice = await this.prisma.invoice.findFirst({ where: { id: data.invoice_id, deleted_at: null } });
      if (activeInvoice) await this.invoiceCalcService.refreshInvoicePayment(data.invoice_id);
    }
    if (entity === 'INVOICE') {
      await this.invoiceCalcService.refreshInvoicePayment(id);
    }
    return data;
  }

  async hardDelete(entity: EntityType, id: number) {
    const delegate = this.getDelegate(entity);
    const trashed = await delegate.findFirst({ where: { id, deleted_at: { not: null } } });
    if (!trashed) throw new NotFoundException('Data tidak ditemukan di Trash.');

    // Collect any image URLs belonging to this record
    const imageUrlsToDelete: string[] = [];
    if (trashed.image_url) imageUrlsToDelete.push(trashed.image_url);
    if (Array.isArray(trashed.image_urls)) imageUrlsToDelete.push(...trashed.image_urls);
    if (trashed.avatar_url) imageUrlsToDelete.push(trashed.avatar_url);
    if (trashed.proof_url) imageUrlsToDelete.push(trashed.proof_url);
    if (trashed.receipt_url) imageUrlsToDelete.push(trashed.receipt_url);
    if (trashed.photo_url) imageUrlsToDelete.push(trashed.photo_url);

    // If deleting an Order permanently, also collect order items' photo_url
    if (entity === 'ORDER') {
      try {
        const items = await this.prisma.order_item.findMany({
          where: { order_id: id },
          select: { photo_url: true },
        });
        items.forEach((item) => {
          if (item.photo_url) imageUrlsToDelete.push(item.photo_url);
        });
      } catch (ignored) {}
    }

    await delegate.delete({ where: { id } });

    // Clean up images from MinIO storage asynchronously
    if (imageUrlsToDelete.length > 0) {
      await this.uploadsService.deleteFilesByUrl(imageUrlsToDelete);
    }

    return { success: true };
  }
}
