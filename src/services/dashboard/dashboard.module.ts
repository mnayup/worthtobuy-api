import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { ReminderService } from '../shared/reminder.service';

@Module({
  providers: [DashboardService, ReminderService],
  controllers: [DashboardController],
})
export class DashboardModule {}
