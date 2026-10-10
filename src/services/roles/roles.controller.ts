import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/roles')
export class RolesController {
  constructor(
    private rolesService: RolesService,
    private prisma: PrismaService,
  ) {}

  @Get('catalog')
  @Roles('OWNER', 'ADMIN')
  getCatalog() {
    return this.rolesService.getCatalog();
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rolesService.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const role = await this.rolesService.create(body);
    await auditLog(this.prisma, userId, 'CREATE', 'Role', String(role.id), { name: role.name }, req.ip);
    return role;
  }

  @Put(':id')
  @Roles('OWNER')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @CurrentUser('id') userId: number,
    @Req() req: any,
  ) {
    const role = await this.rolesService.update(id, body);
    await auditLog(this.prisma, userId, 'UPDATE', 'Role', String(id), { name: role.name, permissionsCount: Array.isArray(body.permissions) ? body.permissions.length : undefined }, req.ip);
    return role;
  }

  @Delete(':id')
  @Roles('OWNER')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @Req() req: any,
  ) {
    await this.rolesService.remove(id);
    await auditLog(this.prisma, userId, 'DELETE', 'Role', String(id), undefined, req.ip);
    return { success: true };
  }
}
