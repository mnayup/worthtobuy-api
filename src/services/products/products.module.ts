import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { StockService } from '../shared/stock.service';

@Module({
  providers: [ProductsService, StockService],
  controllers: [ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}
