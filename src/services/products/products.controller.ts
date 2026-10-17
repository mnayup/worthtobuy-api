import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private prisma: PrismaService,
  ) { }

  @Get()
  @RequirePermissions('products:view')
  async findAll(@Query() query: any) {
    return this.productsService.findAll(query);
  }

  @Get(':id/movements')
  @RequirePermissions('products:view')
  async findMovements(@Param('id') id: string) {
    return this.productsService.findMovements(Number(id));
  }

  @Post()
  @RequirePermissions('products:create')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.productsService.create(body, userId);
    await auditLog(this.prisma, userId, 'CREATE', 'Product', String(data.id), undefined, req.ip);
    return data;
  }

  @Put(':id')
  @RequirePermissions('products:edit')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.productsService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, 'UPDATE', 'Product', String(data.id), body, req.ip);
    return data;
  }

  @Delete(':id')
  @RequirePermissions('products:delete')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.productsService.remove(Number(id), userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'Product', id, undefined, req.ip);
    return { success: true };
  }
}
