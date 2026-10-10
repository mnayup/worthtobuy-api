import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ReminderService } from '../shared/reminder.service';

@Module({
  providers: [NotificationsService, ReminderService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
