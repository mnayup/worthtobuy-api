import { Controller, Get, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ShoppingListService } from './shopping-list.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shopping-list')
export class ShoppingListController {
  constructor(
    private shoppingListService: ShoppingListService,
    private prisma: PrismaService,
  ) { }

  @Get()
  async findAll(@Query() query: any) {
    return this.shoppingListService.findAll(query);
  }

  @Patch(':id/status')
  @Roles('OWNER', 'ADMIN', 'SHOPPER')
  async updateStatus(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.shoppingListService.updateStatus(Number(id), body, userId);
    await auditLog(this.prisma, userId, 'STATUS_CHANGE', 'OrderItem', id, body, req.ip);
    return data;
  }
}
