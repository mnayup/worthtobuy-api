import { PrismaService } from '../../../config/prisma/prisma.service';
import { serializeData as serialize } from '../../../common/interceptors/serialize.interceptor';
import {
  DateWindow,
  TOP_LIMIT,
  currentMonthWindow,
  lastMonthWindow,
  addDays,
  daysBetween,
} from './ai-planner.helper';

const prisma = new PrismaService();

export function dateWhere(window: DateWindow) {
  return window.start && window.end ? { gte: window.start, lt: window.end } : undefined;
}

export function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export async function financialSummary(window: DateWindow) {
  const invoice_date = dateWhere(window);
  const [invoices, payments, expenses, refunds, orders, newCustomers] = await Promise.all([
    prisma.invoice.findMany({
      where: { deleted_at: null, status: { not: 'CANCELLED' }, ...(invoice_date ? { invoice_date } : {}) },
      select: {
        id: true,
        total_bill: true,
        outstanding_amount: true,
        orders: { where: { order: { deleted_at: null } }, select: { order_id: true } },
      },
    }),
    prisma.payment.aggregate({
      where: {
        deleted_at: null,
        status: 'VERIFIED',
        ...(invoice_date ? { payment_date: invoice_date } : {}),
        OR: [{ invoice: { deleted_at: null } }, { order: { deleted_at: null } }],
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { deleted_at: null, ...(invoice_date ? { expense_date: invoice_date } : {}) },
      _count: { _all: true },
      _sum: { amount_idr: true },
    }),
    prisma.refund.aggregate({
      where: { deleted_at: null, status: 'PAID', ...(invoice_date ? { refunded_at: invoice_date } : {}) },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.order.findMany({
      where: { deleted_at: null, ...(invoice_date ? { order_date: invoice_date } : {}) },
      select: { id: true, customer_id: true },
    }),
    prisma.customer.count({ where: { deleted_at: null, ...(invoice_date ? { joined_at: invoice_date } : {}) } }),
  ]);

  const orderIds = [...new Set(invoices.flatMap((invoice) => invoice.orders.map((link) => link.order_id)))];
  const purchases = orderIds.length
    ? await prisma.purchase.aggregate({
        where: { order_item: { order_id: { in: orderIds } } },
        _count: { _all: true },
        _sum: { actual_price: true },
      })
    : { _count: { _all: 0 } as any, _sum: { actual_price: null } };

  const periodCustomerIds = [...new Set(orders.map((order) => order.customer_id))];
  let repeatCustomers = 0;
  if (periodCustomerIds.length) {
    if (window.start) {
      const customersWithEarlierOrders = await prisma.order.groupBy({
        by: ['customer_id'],
        where: { deleted_at: null, customer_id: { in: periodCustomerIds }, order_date: { lt: window.start } },
        _count: { _all: true },
      });
      repeatCustomers = customersWithEarlierOrders.length;
    } else {
      const historical = await prisma.order.groupBy({
        by: ['customer_id'],
        where: { deleted_at: null, customer_id: { in: periodCustomerIds } },
        _count: { _all: true },
      });
      repeatCustomers = historical.filter((row) => row._count._all > 1).length;
    }
  }

  const omzet = invoices.reduce((sum, invoice) => sum + Number(invoice.total_bill), 0);
  const outstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.outstanding_amount), 0);
  const capital = Number(purchases._sum.actual_price || 0);
  const expenseValue = Number(expenses._sum.amount_idr || 0);
  const refundValue = Number(refunds._sum.amount || 0);
  const grossProfit = omzet - capital;
  const netProfit = omzet - capital - expenseValue - refundValue;

  return serialize({
    period: window.label,
    revenueRecognition: 'Omzet dihitung dari total invoice aktif berdasarkan tanggal invoice.',
    omzet,
    invoiceCount: invoices.length,
    transactionCount: orders.length,
    cashIn: Number(payments._sum.amount || 0),
    verifiedPaymentCount: payments._count._all,
    outstandingFromPeriodInvoices: outstanding,
    capital,
    purchaseCount: purchases._count._all,
    expenses: expenseValue,
    expenseCount: expenses._count._all,
    paidRefunds: refundValue,
    paidRefundCount: refunds._count._all,
    grossProfit,
    netProfit,
    netMarginPercent: omzet ? (netProfit / omzet) * 100 : 0,
    newCustomers,
    repeatCustomers,
    uniqueCustomers: periodCustomerIds.length,
  });
}

export async function outstandingSummary() {
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: {
      deleted_at: null,
      outstanding_amount: { gt: 0 },
      status: { notIn: ['PAID', 'CANCELLED'] },
    },
    select: {
      invoice_number: true,
      invoice_date: true,
      due_date: true,
      outstanding_amount: true,
      total_bill: true,
      customer: { select: { full_name: true, customer_code: true } },
    },
    orderBy: [{ outstanding_amount: 'desc' }, { due_date: 'asc' }],
  });
  const overdue = invoices.filter((invoice) => invoice.due_date && invoice.due_date < now);
  return serialize({
    outstandingInvoiceCount: invoices.length,
    totalOutstanding: invoices.reduce((sum, invoice) => sum + Number(invoice.outstanding_amount), 0),
    overdueInvoiceCount: overdue.length,
    overdueOutstanding: overdue.reduce((sum, invoice) => sum + Number(invoice.outstanding_amount), 0),
    highestPriority: invoices.slice(0, TOP_LIMIT).map((invoice) => ({
      invoice_number: invoice.invoice_number,
      customer: invoice.customer.full_name,
      customer_code: invoice.customer.customer_code,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      outstanding: Number(invoice.outstanding_amount),
      total_bill: Number(invoice.total_bill),
      overdue: Boolean(invoice.due_date && invoice.due_date < now),
    })),
  });
}

export async function comparisonSummary(window: DateWindow) {
  if (!window.start || !window.end) {
    return { current: await financialSummary(currentMonthWindow()), previous: await financialSummary(lastMonthWindow()) };
  }
  const span = daysBetween(window.start, window.end);
  const previousStart = window.previousStart || addDays(window.start, -span);
  const previousEnd = window.previousEnd || window.start;
  const current = await financialSummary(window);
  const previous = await financialSummary({ label: `periode sebelumnya (${span} hari)`, start: previousStart, end: previousEnd });
  const keys = ['omzet', 'transactionCount', 'cashIn', 'capital', 'expenses', 'paidRefunds', 'netProfit', 'newCustomers', 'repeatCustomers'] as const;
  const changes = Object.fromEntries(keys.map((key) => [key, percentChange(Number((current as any)[key] || 0), Number((previous as any)[key] || 0))]));
  return serialize({ current, previous, percentageChanges: changes, nullChangeMeaning: 'Nilai null berarti periode sebelumnya bernilai 0 sehingga persentase perubahan tidak dapat dihitung secara bermakna.' });
}
