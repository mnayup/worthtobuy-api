import { Controller, Get, Post, Put, Patch, Body, Param, Query, UseGuards, Req } from "@nestjs/common";
import { ShipmentsService } from "./shipments.service";
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(
    private shipmentsService: ShipmentsService,
    private prisma: PrismaService,
  ) { }

  @Get('summary')
  async getSummary() {
    return this.shipmentsService.getSummary();
  }

  @Get()
  async findAll(@Query() query: any) {
    return this.shipmentsService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.shipmentsService.findOne(Number(id));
  }

  @Post()
  @Roles("OWNER", "ADMIN")
  async create(@Body() body: any, @CurrentUser("id") userId: number, @Req() req: any) {
    const data = await this.shipmentsService.create(body, userId);
    await auditLog(this.prisma, userId, "CREATE", "Shipment", String(data.id), undefined, req.ip);
    return data;
  }

  @Put(":id")
  @Roles("OWNER", "ADMIN")
  async update(@Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: number, @Req() req: any) {
    const data = await this.shipmentsService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, "UPDATE", "Shipment", String(data.id), body, req.ip);
    return data;
  }

  @Put(":id/status")
  @Roles("OWNER", "ADMIN")
  async updateStatus(@Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: number, @Req() req: any) {
    const data = await this.shipmentsService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, "UPDATE_STATUS", "Shipment", String(data.id), body, req.ip);
    return data;
  }

  @Patch(":id/status")
  @Roles("OWNER", "ADMIN")
  async patchStatus(@Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: number, @Req() req: any) {
    const data = await this.shipmentsService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, "UPDATE_STATUS", "Shipment", String(data.id), body, req.ip);
    return data;
  }
}
