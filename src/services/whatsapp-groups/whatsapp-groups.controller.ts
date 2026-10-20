import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { WhatsappGroupsService } from './whatsapp-groups.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('whatsapp-groups')
export class WhatsappGroupsController {
  constructor(
    private whatsappGroupsService: WhatsappGroupsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async findAll(@Query() query: any) {
    return this.whatsappGroupsService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.whatsappGroupsService.findOne(Number(id));
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async create(@Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.whatsappGroupsService.create(body, userId);
    await auditLog(this.prisma, userId, 'CREATE', 'WhatsappGroup', String(data.id), undefined, req.ip);
    return data;
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.whatsappGroupsService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, 'UPDATE', 'WhatsappGroup', String(data.id), body, req.ip);
    return data;
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.whatsappGroupsService.remove(Number(id), userId);
    await auditLog(this.prisma, userId, 'MOVE_TO_TRASH', 'WhatsappGroup', id, undefined, req.ip);
    return { success: true };
  }
}
