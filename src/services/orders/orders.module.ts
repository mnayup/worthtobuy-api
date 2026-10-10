import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { FeeService } from '../shared/fee.service';
import { StockService } from '../shared/stock.service';
import { RefundService } from '../shared/refund.service';
import { InvoiceCalcService } from '../shared/invoice-calc.service';

@Module({
  providers: [OrdersService, FeeService, StockService, RefundService, InvoiceCalcService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
