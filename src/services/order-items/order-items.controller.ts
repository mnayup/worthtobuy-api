import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { OrderItemsService } from './order-items.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('order-items')
export class OrderItemsController {
  constructor(
    private orderItemsService: OrderItemsService,
    private prisma: PrismaService,
  ) { }

  @Get('kept-customers')
  async getKeptCustomers(@Query() query: any) {
    return this.orderItemsService.getKeptCustomers(query);
  }

  @Post('move-to-shipment')
  @Roles('OWNER', 'ADMIN')
  async moveToShipment(
    @Body() body: { itemIds: number[] },
    @CurrentUser('id') userId: number,
    @Req() req: any
  ) {
    const data = await this.orderItemsService.moveToShipment(body.itemIds, userId);
    await auditLog(
      this.prisma,
      userId,
      'STATUS_CHANGE',
      'OrderItem',
      (body.itemIds || []).join(','),
      { action: 'MOVE_TO_SHIPMENT', count: data.count },
      req.ip
    );
    return data;
  }

  @Get()
  async findAll(@Query() query: any) {
    return this.orderItemsService.findAll(query);
  }

  @Get(':id/history')
  async findHistory(@Param('id') id: string) {
    return this.orderItemsService.findHistory(Number(id));
  }

  @Patch(':id/status')
  @Roles('OWNER', 'ADMIN', 'SHOPPER', 'FINANCE')
  async updateStatus(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.orderItemsService.updateStatus(Number(id), body, userId);
    await auditLog(this.prisma, userId, 'STATUS_CHANGE', 'OrderItem', id, body, req.ip);
    return data;
  }
}
