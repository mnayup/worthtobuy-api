import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(
    private expensesService: ExpensesService,
    private prisma: PrismaService,
  ) { }

  @Get()
  async findAll(@Query() query: any) {
    return this.expensesService.findAll(query);
  }

  @Post()
  @Roles('OWNER', 'FINANCE')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.expensesService.create(body);
    await auditLog(this.prisma, userId, 'CREATE', 'Expense', String(data.id), undefined, req.ip);
    return data;
  }

  @Put(':id')
  @Roles('OWNER', 'FINANCE')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.expensesService.update(Number(id), body);
    await auditLog(this.prisma, userId, 'UPDATE', 'Expense', String(data.id), body, req.ip);
    return data;
  }

  @Delete(':id')
  @Roles('OWNER', 'FINANCE')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.expensesService.remove(Number(id), userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'Expense', id, undefined, req.ip);
    return { success: true };
  }
}
