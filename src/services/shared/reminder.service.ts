import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(private prisma: PrismaService) { }

  async syncPaymentReminders() {
    try {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const invoices = await this.prisma.invoice.findMany({
        where: {
          due_date: { lte: tomorrow },
          outstanding_amount: { gt: 0 },
          status: { notIn: ['CANCELLED', 'PAID'] },
        },
        include: { customer: true },
        take: 100,
      });

      for (const invoice of invoices) {
        if (!invoice.due_date) continue;
        const overdue = invoice.due_date.getTime() < now.getTime();
        const dedupe_key = `PAYMENT-DUE-${invoice.id}-${dateKey(now)}`;
        await this.prisma.notification.upsert({
          where: { dedupe_key },
          update: {
            title: overdue ? 'Invoice melewati jatuh tempo' : 'Invoice segera jatuh tempo',
            message: `${invoice.invoice_number} • ${invoice.customer.full_name} • Sisa Rp${Number(invoice.outstanding_amount).toLocaleString('id-ID')}`,
            link: `/invoices/${invoice.id}`,
          },
          create: {
            type: 'PAYMENT',
            title: overdue ? 'Invoice melewati jatuh tempo' : 'Invoice segera jatuh tempo',
            message: `${invoice.invoice_number} • ${invoice.customer.full_name} • Sisa Rp${Number(invoice.outstanding_amount).toLocaleString('id-ID')}`,
            link: `/invoices/${invoice.id}`,
            dedupe_key,
          },
        });
      }
      return invoices.length;
    } catch (err) {
      this.logger.error('Failed to sync payment reminders:', err);
      return 0;
    }
  }
}
