import { Module } from '@nestjs/common';
import { TrashService } from './trash.service';
import { TrashController } from './trash.controller';
import { InvoiceCalcService } from '../shared/invoice-calc.service';
import { RefundService } from '../shared/refund.service';

@Module({
  providers: [TrashService, InvoiceCalcService, RefundService],
  controllers: [TrashController],
  exports: [TrashService],
})
export class TrashModule {}
