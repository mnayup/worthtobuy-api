import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private ordersService: OrdersService,
    private prisma: PrismaService,
  ) { }

  @Get('fee-preview')
  async feePreview(@Query('amount') amount: string, @Query('mode') mode?: string) {
    return this.ordersService.getFeePreview(Math.max(0, Number(amount || 0)), mode);
  }

  @Get()
  async findAll(@Query() query: any) {
    return this.ordersService.findAll(query);
  }

  @Get('summary')
  async getSummary() {
    return this.ordersService.getSummary();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.ordersService.findOne(Number(id));
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.ordersService.create(body, userId);
    await auditLog(this.prisma, userId, 'CREATE', 'Order', String(data.id), undefined, req.ip);
    return data;
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.ordersService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, 'UPDATE', 'Order', String(data.id), body, req.ip);
    return data;
  }

  @Delete(':id')
  @Roles('OWNER')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.ordersService.remove(Number(id), userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'Order', id, undefined, req.ip);
    return { success: true };
  }
}
