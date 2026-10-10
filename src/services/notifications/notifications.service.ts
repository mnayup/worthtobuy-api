import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { ReminderService } from '../shared/reminder.service';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private reminderService: ReminderService,
  ) { }

  async findAll(user_id: number) {
    await this.reminderService.syncPaymentReminders();
    return this.prisma.notification.findMany({
      where: { OR: [{ user_id: null }, { user_id }] },
      take: 30,
      orderBy: { created_at: 'desc' },
    });
  }

  async markAsRead(id: number) {
    return this.prisma.notification.update({
      where: { id },
      data: { is_read: true },
    });
  }
}
