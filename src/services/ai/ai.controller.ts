import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Get('status')
  @Roles('OWNER', 'FINANCE', 'ADMIN')
  getStatus(@CurrentUser('role') role: string) {
    return this.aiService.getStatus(role);
  }

  @Post('chat')
  @Roles('OWNER', 'FINANCE', 'ADMIN')
  async chat(@Body() body: { question: string; conversationId?: string }, @CurrentUser() user: any) {
    return this.aiService.chat(user.id, user.role, body.question, body.conversationId);
  }

  @Get('history')
  @Roles('OWNER', 'FINANCE', 'ADMIN')
  async getHistory(@Query('limit') limit: string, @Query('conversationId') conversationId: string, @CurrentUser('id') userId: number) {
    return this.aiService.getHistory(userId, limit ? Number(limit) : undefined, conversationId);
  }

  @Post('report')
  @Roles('OWNER', 'FINANCE')
  async generateReport(@Body() body: { conversationId?: string }, @CurrentUser() user: any) {
    return this.aiService.generateWeeklyReport(user.id, user.role, body?.conversationId);
  }

  @Post('business-summary')
  @Roles('OWNER', 'FINANCE')
  async getBusinessSummary(@CurrentUser() user: any) {
    return this.aiService.getBusinessSummary(user.id, user.role);
  }
}
