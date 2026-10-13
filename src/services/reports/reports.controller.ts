import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) { }

  @Get('profit-loss')
  @Roles('OWNER', 'FINANCE')
  async getProfitLoss(@Query('periodId') periodId: string, @CurrentUser('canViewProfit') canViewProfit: boolean) {
    return this.reportsService.getProfitLoss(periodId ? Number(periodId) : undefined, canViewProfit);
  }

  @Get('period-performance')
  @Roles('OWNER', 'FINANCE')
  async getPeriodPerformance() {
    return this.reportsService.getPeriodPerformance();
  }
}
