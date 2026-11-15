import { Module } from '@nestjs/common';
import { OrderItemsService } from './order-items.service';
import { OrderItemsController } from './order-items.controller';
import { StockService } from '../shared/stock.service';
import { RefundService } from '../shared/refund.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { FeeService } from '../shared/fee.service';
import { ReminderService } from '../shared/reminder.service';

@Module({
  providers: [
    OrderItemsService,
    StockService,
    RefundService,
    InvoiceCalcService,
    FeeService,
    ReminderService,
  ],
  controllers: [OrderItemsController],
  exports: [OrderItemsService],
})
export class OrderItemsModule {}
