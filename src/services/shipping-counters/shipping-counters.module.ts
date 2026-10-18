import { Module } from '@nestjs/common';
import { ShippingCountersController } from './shipping-counters.controller';
import { ShippingCountersService } from './shipping-counters.service';

@Module({
  controllers: [ShippingCountersController],
  providers: [ShippingCountersService],
  exports: [ShippingCountersService],
})
export class ShippingCountersModule {}
