import { Controller, Get, Post, Delete, Param, Query, UseGuards, Req } from '@nestjs/common';
import { TrashService } from './trash.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/trash')
export class TrashController {
  constructor(
    private trashService: TrashService,
    private prisma: PrismaService,
  ) { }

  @Get()
  @Roles('OWNER')
  async findAll(@Query() query: any) {
    return this.trashService.findAll(query);
  }

  @Post(':entity/:id/restore')
  @Roles('OWNER')
  async restore(@Param('entity') entity: string, @Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    const data = await this.trashService.restore(entity.toUpperCase() as any, Number(id));
    await auditLog(this.prisma, userId, 'RESTORE', entity.toUpperCase(), id, undefined, req.ip);
    return data;
  }

  @Delete(':entity/:id')
  @Roles('OWNER')
  async hardDelete(@Param('entity') entity: string, @Param('id') id: string, @CurrentUser('id') userId: number, @Req() req: any) {
    await this.trashService.hardDelete(entity.toUpperCase() as any, Number(id));
    await auditLog(this.prisma, userId, 'PERMANENT_DELETE', entity.toUpperCase(), id, undefined, req.ip);
    return { success: true };
  }
}
