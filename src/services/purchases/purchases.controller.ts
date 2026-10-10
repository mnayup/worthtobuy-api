import { Controller, Get, Post, Put, Patch, Body, Param, Query, UseGuards, Req } from "@nestjs/common";
import { PurchasesService } from "./purchases.service";
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { auditLog } from '../../common/utils/audit.utils';
import { PrismaService } from '../../config/prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("api/purchases")
export class PurchasesController {
  @Get('summary')
  async getSummary() {
    return this.purchasesService.getSummary();
  }

  constructor(
    private purchasesService: PurchasesService,
    private prisma: PrismaService,
  ) { }

  @Get()
  async findAll(@Query() query: any) {
    return this.purchasesService.findAll(query);
  }

  @Post()
  @Roles("OWNER", "ADMIN", "SHOPPER")
  async create(@Body() body: any, @CurrentUser("id") userId: number, @Req() req: any) {
    const data = await this.purchasesService.create(body, userId);
    await auditLog(this.prisma, userId, "CREATE", "Purchase", String(data.id), undefined, req.ip);
    return data;
  }

  @Put(":id")
  @Roles("OWNER", "ADMIN", "SHOPPER")
  async update(@Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: number, @Req() req: any) {
    const data = await this.purchasesService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, "UPDATE", "Purchase", String(data.id), body, req.ip);
    return data;
  }

  @Put(":id/status")
  @Roles("OWNER", "ADMIN", "SHOPPER")
  async updateStatus(@Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: number, @Req() req: any) {
    const data = await this.purchasesService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, "UPDATE_STATUS", "Purchase", String(data.id), body, req.ip);
    return data;
  }

  @Patch(":id/status")
  @Roles("OWNER", "ADMIN", "SHOPPER")
  async patchStatus(@Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: number, @Req() req: any) {
    const data = await this.purchasesService.update(Number(id), body, userId);
    await auditLog(this.prisma, userId, "UPDATE_STATUS", "Purchase", String(data.id), body, req.ip);
    return data;
  }
}
