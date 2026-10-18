import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ShippingCountersService } from './shipping-counters.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shipping-counters')
export class ShippingCountersController {
  constructor(
    private shippingCountersService: ShippingCountersService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async findAll(@Query() query: any) {
    return this.shippingCountersService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.shippingCountersService.findOne(Number(id));
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.shippingCountersService.create(body, userId);
    await auditLog(this.prisma, userId, 'CREATE', 'ShippingCounter', String(data.id), undefined, req.ip);
    return data;
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.shippingCountersService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, 'UPDATE', 'ShippingCounter', String(data.id), body, req.ip);
    return data;
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.shippingCountersService.remove(Number(id), userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'ShippingCounter', id, undefined, req.ip);
    return { success: true };
  }
}
