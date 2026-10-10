import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { RefundService } from '../shared/refund.service';

import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  providers: [InvoicesService, InvoiceCalcService, RefundService],
  controllers: [InvoicesController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
