import { Module } from "@nestjs/common";
import { PurchasesService } from "./purchases.service";
import { PurchasesController } from "./purchases.controller";
import { RefundService } from '../shared/refund.service';
import { StockService } from '../shared/stock.service';

@Module({
  providers: [PurchasesService, RefundService, StockService],
  controllers: [PurchasesController],
  exports: [PurchasesService],
})
export class PurchasesModule {}
