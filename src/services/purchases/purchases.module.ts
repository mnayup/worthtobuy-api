import { Module } from "@nestjs/common";
import { PurchasesService } from "./purchases.service";
import { PurchasesController } from "./purchases.controller";
import { RefundService } from '../shared/refund.service';

@Module({
  providers: [PurchasesService, RefundService],
  controllers: [PurchasesController],
  exports: [PurchasesService],
})
export class PurchasesModule {}
