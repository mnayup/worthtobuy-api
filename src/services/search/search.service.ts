import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

const LIMIT_PER_GROUP = 8;

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) { }

  async search(queryText: string, role: string) {
    const query = String(queryText || '').trim().slice(0, 100);
    if (query.length < 2) {
      return { query, total: 0, groups: [] };
    }

    const canTransactions = ['OWNER', 'ADMIN', 'FINANCE'].includes(role);
    const canCatalog = ['OWNER', 'ADMIN', 'SHOPPER'].includes(role);
    const canTracking = ['OWNER', 'ADMIN', 'SHOPPER', 'FINANCE'].includes(role);
    const canShopping = ['OWNER', 'ADMIN', 'SHOPPER'].includes(role);
    const canShipping = ['OWNER', 'ADMIN'].includes(role);
    const canFinance = ['OWNER', 'FINANCE'].includes(role);
    const isOwner = role === 'OWNER';

    const [periods, customers, products, orders, invoices, items, purchases, payments, shipments, expenses, refunds, users] =
      await Promise.all([
        this.prisma.jastip_period.findMany({
          where: {
            deleted_at: null, OR: [
              { code: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } },
              { city: { contains: query, mode: 'insensitive' } },
            ]
          },
          take: LIMIT_PER_GROUP,
          orderBy: { departure_at: 'desc' },
          select: { id: true, code: true, name: true, city: true },
        }),
        canTransactions
          ? this.prisma.customer.findMany({
            where: {
              deleted_at: null, OR: [
                { customer_code: { contains: query, mode: 'insensitive' } },
                { full_name: { contains: query, mode: 'insensitive' } },
                { whatsapp: { contains: query } },
                { email: { contains: query, mode: 'insensitive' } },
                { city: { contains: query, mode: 'insensitive' } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { created_at: 'desc' },
            select: { id: true, customer_code: true, full_name: true, whatsapp: true, city: true },
          })
          : Promise.resolve([]),
        canCatalog
          ? this.prisma.product.findMany({
            where: {
              deleted_at: null, OR: [
                { sku: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } },
                { brand_name: { contains: query, mode: 'insensitive' } },
                { category: { contains: query, mode: 'insensitive' } },
                { store_location: { contains: query, mode: 'insensitive' } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { created_at: 'desc' },
            select: { id: true, sku: true, name: true, brand_name: true, stock_mode: true },
          })
          : Promise.resolve([]),
        canTransactions
          ? this.prisma.order.findMany({
            where: {
              deleted_at: null, OR: [
                { order_number: { contains: query, mode: 'insensitive' } },
                { customer: { full_name: { contains: query, mode: 'insensitive' } } },
                { customer: { whatsapp: { contains: query } } },
                { period: { code: { contains: query, mode: 'insensitive' } } },
                { items: { some: { manual_product_name: { contains: query, mode: 'insensitive' } } } },
                { items: { some: { product: { name: { contains: query, mode: 'insensitive' } } } } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { order_date: 'desc' },
            select: { id: true, order_number: true, status: true, customer: { select: { full_name: true } }, period: { select: { code: true } } },
          })
          : Promise.resolve([]),
        canTransactions
          ? this.prisma.invoice.findMany({
            where: {
              deleted_at: null, OR: [
                { invoice_number: { contains: query, mode: 'insensitive' } },
                { customer: { full_name: { contains: query, mode: 'insensitive' } } },
                { customer: { whatsapp: { contains: query } } },
                { orders: { some: { order: { order_number: { contains: query, mode: 'insensitive' } } } } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { invoice_date: 'desc' },
            select: { id: true, invoice_number: true, status: true, customer: { select: { full_name: true } }, outstanding_amount: true },
          })
          : Promise.resolve([]),
        canTracking
          ? this.prisma.order_item.findMany({
            where: {
              order: { deleted_at: null },
              OR: [
                { manual_product_name: { contains: query, mode: 'insensitive' } },
                { brand_name: { contains: query, mode: 'insensitive' } },
                { variation: { contains: query, mode: 'insensitive' } },
                { product: { name: { contains: query, mode: 'insensitive' } } },
                { product: { sku: { contains: query, mode: 'insensitive' } } },
              ],
            },
            take: LIMIT_PER_GROUP,
            orderBy: { created_at: 'desc' },
            select: { id: true, manual_product_name: true, brand_name: true, fulfillment_status: true, product: { select: { name: true } }, order: { select: { order_number: true } } },
          })
          : Promise.resolve([]),
        canShopping
          ? this.prisma.purchase.findMany({
            where: {
              order_item: { order: { deleted_at: null } }, OR: [
                { purchase_number: { contains: query, mode: 'insensitive' } },
                { brand_name: { contains: query, mode: 'insensitive' } },
                { product: { name: { contains: query, mode: 'insensitive' } } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { purchase_date: 'desc' },
            select: { id: true, purchase_number: true, brand_name: true, actual_price: true, product: { select: { name: true } } },
          })
          : Promise.resolve([]),
        canTransactions
          ? this.prisma.payment.findMany({
            where: {
              deleted_at: null, OR: [
                { payment_number: { contains: query, mode: 'insensitive' } },
                { method: { contains: query, mode: 'insensitive' } },
                { destination_account: { contains: query, mode: 'insensitive' } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { payment_date: 'desc' },
            select: { id: true, payment_number: true, method: true, amount: true, status: true },
          })
          : Promise.resolve([]),
        canShipping
          ? this.prisma.shipment.findMany({
            where: {
              order: { deleted_at: null }, OR: [
                { tracking_number: { contains: query, mode: 'insensitive' } },
                { courier: { contains: query, mode: 'insensitive' } },
                { address: { contains: query, mode: 'insensitive' } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { created_at: 'desc' },
            select: { id: true, tracking_number: true, courier: true, status: true, customer: { select: { full_name: true } } },
          })
          : Promise.resolve([]),
        canFinance
          ? this.prisma.expense.findMany({
            where: {
              deleted_at: null, OR: [
                { expense_number: { contains: query, mode: 'insensitive' } },
                { category: { contains: query, mode: 'insensitive' } },
                { payee: { contains: query, mode: 'insensitive' } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { expense_date: 'desc' },
            select: { id: true, expense_number: true, category: true, amount_idr: true },
          })
          : Promise.resolve([]),
        canFinance
          ? this.prisma.refund.findMany({
            where: {
              deleted_at: null, OR: [
                { refund_number: { contains: query, mode: 'insensitive' } },
                { reason: { contains: query, mode: 'insensitive' } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { created_at: 'desc' },
            select: { id: true, refund_number: true, reason: true, amount: true, status: true },
          })
          : Promise.resolve([]),
        isOwner
          ? this.prisma.user.findMany({
            where: {
              deleted_at: null, OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
              ]
            },
            take: LIMIT_PER_GROUP,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, email: true, role: { select: { name: true } } },
          })
          : Promise.resolve([]),
      ]);

    const groups: Array<{ key: string; label: string; items: any[] }> = [];

    if (periods.length) groups.push({ key: 'periods', label: 'Event Jastip', items: periods.map(p => ({ id: p.id, title: p.code, subtitle: `${p.name} • ${p.city || 'Indonesia'}`, href: '/periods' })) });
    if (customers.length) groups.push({ key: 'customers', label: 'Pelanggan', items: customers.map(c => ({ id: c.id, title: c.full_name, subtitle: `${c.customer_code} • ${c.whatsapp}`, href: `/customers/${c.id}` })) });
    if (products.length) groups.push({ key: 'products', label: 'Produk', items: products.map(p => ({ id: p.id, title: p.name, subtitle: `${p.sku} • ${p.brand_name || '-'} • ${p.stock_mode}`, href: '/products' })) });
    if (orders.length) groups.push({ key: 'orders', label: 'Pesanan', items: orders.map(o => ({ id: o.id, title: o.order_number, subtitle: `${o.customer.full_name} • ${o.period.code} • ${o.status}`, href: '/orders' })) });
    if (invoices.length) groups.push({ key: 'invoices', label: 'Invoice', items: invoices.map(i => ({ id: i.id, title: i.invoice_number, subtitle: `${i.customer.full_name} • ${i.status} • Sisa Rp${Number(i.outstanding_amount).toLocaleString('id-ID')}`, href: `/invoices/${i.id}` })) });
    if (items.length) groups.push({ key: 'items', label: 'Track Barang', items: items.map(i => ({ id: i.id, title: i.product?.name || i.manual_product_name || 'Item', subtitle: `${i.order.order_number} • ${i.fulfillment_status}`, href: '/item-tracking' })) });
    if (purchases.length) groups.push({ key: 'purchases', label: 'Pembelian', items: purchases.map(p => ({ id: p.id, title: p.purchase_number, subtitle: `${p.product?.name || p.brand_name} • Rp${Number(p.actual_price).toLocaleString('id-ID')}`, href: '/purchases' })) });
    if (payments.length) groups.push({ key: 'payments', label: 'Pembayaran', items: payments.map(p => ({ id: p.id, title: p.payment_number, subtitle: `${p.method} • Rp${Number(p.amount).toLocaleString('id-ID')} • ${p.status}`, href: '/payments' })) });
    if (shipments.length) groups.push({ key: 'shipments', label: 'Pengiriman', items: shipments.map(s => ({ id: s.id, title: s.tracking_number || 'Belum ada resi', subtitle: `${s.courier} • ${s.customer.full_name} • ${s.status}`, href: '/shipments' })) });
    if (expenses.length) groups.push({ key: 'expenses', label: 'Pengeluaran', items: expenses.map(e => ({ id: e.id, title: e.expense_number, subtitle: `${e.category} • Rp${Number(e.amount_idr).toLocaleString('id-ID')}`, href: '/expenses' })) });
    if (refunds.length) groups.push({ key: 'refunds', label: 'Refund', items: refunds.map(r => ({ id: r.id, title: r.refund_number, subtitle: `${r.reason} • Rp${Number(r.amount).toLocaleString('id-ID')} • ${r.status}`, href: '/refunds' })) });
    if (users.length) groups.push({ key: 'users', label: 'Pengguna', items: users.map(u => ({ id: u.id, title: u.name, subtitle: `${u.email} • ${u.role.name}`, href: '/users' })) });

    const total = groups.reduce((sum, g) => sum + g.items.length, 0);
    return { query, total, groups };
  }
}
