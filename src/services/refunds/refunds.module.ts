import { Module } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { RefundsController } from './refunds.controller';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { RefundService } from '../shared/refund.service';

import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  providers: [RefundsService, InvoiceCalcService, RefundService],
  controllers: [RefundsController],
  exports: [RefundsService],
})
export class RefundsModule {}
