import { Controller, Get, BadRequestException, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(
    private invoicesService: InvoicesService,
    private prisma: PrismaService,
  ) { }

  @Get('summary')
  async getSummary() {
    return this.invoicesService.getSummary();
  }

  @Get('available-orders')
  async getAvailableOrders(@Query() query: any) {
    return this.invoicesService.getAvailableOrders(query);
  }

  @Get('unpacked-invoices')
  async getUnpackedInvoices(@Query('customerId') customerId: string) {
    return this.invoicesService.getUnpackedInvoiceOptions(Number(customerId));
  }

  @Get()
  async findAll(@Query() query: any) {
    return this.invoicesService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const numId = Number(id);
    if (isNaN(numId)) {
      throw new BadRequestException('Invalid invoice ID: ' + id);
    }
    return this.invoicesService.findOne(numId);
  }

  @Post('bulk-issue')
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async bulkIssue(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.invoicesService.bulkIssue(body, userId);
    await auditLog(this.prisma, userId, 'CREATE', 'Invoice', 'BULK_ISSUE', { orderIds: body.orderIds, count: data.count }, req.ip);
    return data;
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.invoicesService.create(body);
    await auditLog(this.prisma, userId, 'CREATE', 'Invoice', String(data.id), { orderIds: body.orderIds }, req.ip);
    return data;
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.invoicesService.update(Number(id), body);
    await auditLog(this.prisma, userId, 'UPDATE', 'Invoice', String(data.id), body, req.ip);
    return data;
  }

  @Delete(':id')
  @Roles('OWNER')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.invoicesService.remove(Number(id), userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'Invoice', id, undefined, req.ip);
    return { success: true };
  }
}
