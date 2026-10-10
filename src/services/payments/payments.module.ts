import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { RefundService } from '../shared/refund.service';

@Module({
  providers: [PaymentsService, InvoiceCalcService, RefundService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
