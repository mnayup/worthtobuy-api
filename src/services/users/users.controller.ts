import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, Query, UseGuards, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private prisma: PrismaService,
  ) { }

  // ================= CURRENT USER PROFILE & MFA =================

  @Get('profile')
  async getProfile(@CurrentUser('id') userId: number) {
    return this.usersService.getProfile(userId);
  }

  @Put('profile')
  async updateProfile(
    @CurrentUser('id') userId: number,
    @Body() body: any,
    @Req() req: any,
  ) {
    const updated = await this.usersService.updateProfile(userId, body);
    await auditLog(this.prisma, userId, 'UPDATE', 'UserProfile', String(userId), { updatedFields: Object.keys(body) }, req.ip);
    return updated;
  }

  @Put('profile/password')
  async changePassword(
    @CurrentUser('id') userId: number,
    @Body() body: { currentPassword: string; newPassword: string },
    @Req() req: any,
  ) {
    const res = await this.usersService.changePassword(userId, body.currentPassword, body.newPassword);
    await auditLog(this.prisma, userId, 'UPDATE', 'UserPassword', String(userId), undefined, req.ip);
    return res;
  }

  @Get('profile/mfa/setup')
  async setupMfa(@CurrentUser('id') userId: number) {
    return this.usersService.setupMfa(userId);
  }

  @Post('profile/mfa/enable')
  async enableMfa(
    @CurrentUser('id') userId: number,
    @Body() body: { code: string; secret: string },
    @Req() req: any,
  ) {
    const res = await this.usersService.enableMfa(userId, body.code, body.secret);
    await auditLog(this.prisma, userId, 'UPDATE', 'UserMFA', String(userId), { action: 'ENABLE_MFA' }, req.ip);
    return res;
  }

  @Post('profile/mfa/disable')
  async disableMfa(
    @CurrentUser('id') userId: number,
    @Body() body: { passwordOrCode: string },
    @Req() req: any,
  ) {
    const res = await this.usersService.disableMfa(userId, body.passwordOrCode);
    await auditLog(this.prisma, userId, 'UPDATE', 'UserMFA', String(userId), { action: 'DISABLE_MFA' }, req.ip);
    return res;
  }

  // ================= ADMIN USER MANAGEMENT =================

  @Get('roles')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async getRoles() {
    return this.usersService.getRoles();
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async findAll(@Query() query: any) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.usersService.create(body);
    await auditLog(this.prisma, userId, 'CREATE', 'User', String(data.id), { username: data.username, roleId: body.roleId }, req.ip);
    return data;
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @CurrentUser('id') userId: number,
    @Req() req: any,
  ) {
    const data = await this.usersService.update(id, body);
    await auditLog(this.prisma, userId, 'UPDATE', 'User', String(id), { username: data.username, roleId: body.roleId }, req.ip);
    return data;
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.usersService.remove(id, userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'User', String(id), undefined, req.ip);
    return { success: true };
  }
}
