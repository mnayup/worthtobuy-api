import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/customers')
export class CustomersController {
  constructor(
    private customersService: CustomersService,
    private prisma: PrismaService,
  ) { }

  @Get()
  async findAll(@Query() query: any) {
    return this.customersService.findAll(query);
  }

  @Get(':id/overview')
  async findOverview(@Param('id') id: string) {
    return this.customersService.findOverview(Number(id));
  }

  @Get(':id/deposit-balance')
  async getDepositBalance(@Param('id') id: string, @Query('excludeInvoiceId') excludeInvoiceId?: string) {
    return this.customersService.getDepositBalance(Number(id), excludeInvoiceId ? Number(excludeInvoiceId) : undefined);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.customersService.findOne(Number(id));
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.customersService.create(body, userId);
    await auditLog(this.prisma, userId, 'CREATE', 'Customer', String(data.id), undefined, req.ip);
    return data;
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.customersService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, 'UPDATE', 'Customer', String(data.id), body, req.ip);
    return data;
  }

  @Delete(':id')
  @Roles('OWNER')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.customersService.remove(Number(id), userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'Customer', id, undefined, req.ip);
    return { success: true };
  }
}
