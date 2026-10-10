import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/refunds')
export class RefundsController {
  constructor(
    private refundsService: RefundsService,
    private prisma: PrismaService,
  ) { }

  @Get()
  @Roles('OWNER', 'FINANCE')
  async findAll(@Query() query: any) {
    return this.refundsService.findAll(query);
  }

  @Post()
  @Roles('OWNER', 'FINANCE')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.refundsService.create(body);
    await auditLog(this.prisma, userId, 'CREATE', 'Refund', String(data.id), undefined, req.ip);
    return data;
  }

  @Put(':id')
  @Roles('OWNER', 'FINANCE')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.refundsService.update(Number(id), body);
    await auditLog(this.prisma, userId, 'UPDATE', 'Refund', String(data.id), body, req.ip);
    return data;
  }

  @Put(':id/process')
  @Roles('OWNER', 'FINANCE')
  async process(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.refundsService.processRefund(Number(id), body);
    await auditLog(this.prisma, userId, 'PROCESS_REFUND', 'Refund', String(data.id), body, req.ip);
    return data;
  }

  @Delete(':id')
  @Roles('OWNER')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.refundsService.remove(Number(id), userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'Refund', id, undefined, req.ip);
    return { success: true };
  }
}
