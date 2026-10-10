import { Injectable, BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { buildAiContext, buildWeeklyBusinessReportContext, createAiQueryPlan, AiRole } from './ai-context';
import { generateChatAnswer, generateWeeklyReport, geminiStatus } from './gemini-client';

const requestBuckets = new Map<number, number[]>();

// Exported interface for AI chat and report history
export interface AiHistoryEntry {
  id: number;
  userId: number;
  action: 'AI_CHAT' | 'AI_BUSINESS_REPORT';
  conversationId: string;
  question?: string;
  answer?: string;
  role?: string;
  intent?: string;
  modules?: string[];
  sources?: string[];
  period?: string;
  reportSummary?: string;
  createdAt: string;
}

const memoryHistory: AiHistoryEntry[] = [];
let nextHistoryId = 1;

function enforceRateLimit(userId: number) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const limit = Math.min(100, Math.max(5, Number(process.env.AI_RATE_LIMIT_PER_5_MIN || 20)));
  const recent = (requestBuckets.get(userId) || []).filter(timestamp => now - timestamp < windowMs);
  if (recent.length >= limit) {
    throw new HttpException(`Batas penggunaan AI tercapai. Maksimal ${limit} permintaan per 5 menit.`, HttpStatus.TOO_MANY_REQUESTS);
  }
  recent.push(now);
  requestBuckets.set(userId, recent);
}

function safeRole(role: string): AiRole {
  if (!['OWNER', 'FINANCE', 'ADMIN'].includes(role)) {
    throw new ForbiddenException('Role ini tidak memiliki akses ke WORTHTOBUY AI Assistant.');
  }
  return role as AiRole;
}

function formatAnswer(result: { insight: string; recommendations?: string[]; caveats?: string[] }) {
  const lines = [`Insight:\n${result.insight.trim()}`];
  const recommendations = (result.recommendations || []).filter(Boolean).slice(0, 5);
  if (recommendations.length) lines.push(`Recommendation:\n${recommendations.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
  const caveats = (result.caveats || []).filter(Boolean).slice(0, 4);
  if (caveats.length) lines.push(`Catatan:\n${caveats.map(item => `- ${item}`).join('\n')}`);
  return lines.join('\n\n');
}

@Injectable()
export class AiService {
  getStatus(role: string) {
    const aiRole = safeRole(role);
    return { ...geminiStatus(), role: aiRole };
  }

  async getConversationHistory(userId: number, conversationId: string) {
    return memoryHistory
      .filter(item => item.userId === userId && item.action === 'AI_CHAT' && item.conversationId === conversationId && item.question && item.answer)
      .slice(-6)
      .map(m => ({ question: m.question!, answer: m.answer! }));
  }

  async chat(userId: number, userRole: string, question: string, convId?: string) {
    enforceRateLimit(userId);
    const role = safeRole(userRole);
    const conversationId = convId || randomUUID();
    const plan = createAiQueryPlan(question, role);

    if (plan.deniedReason) {
      throw new ForbiddenException(plan.deniedReason);
    }

    try {
      const [context, history] = await Promise.all([
        buildAiContext(plan, role),
        this.getConversationHistory(userId, conversationId),
      ]);
      const generated = await generateChatAnswer(question, context, history);
      const answer = formatAnswer(generated.data);
      const generatedAt = new Date().toISOString();

      memoryHistory.push({
        id: nextHistoryId++,
        userId,
        action: 'AI_CHAT',
        conversationId,
        question,
        answer: answer.slice(0, 12000),
        role,
        intent: plan.intent,
        modules: plan.modules,
        sources: plan.sources,
        period: plan.window.label,
        createdAt: generatedAt,
      });

      if (memoryHistory.length > 500) {
        memoryHistory.splice(0, memoryHistory.length - 500);
      }

      return {
        answer,
        plan: {
          intent: plan.intent,
          modules: plan.modules,
          sources: plan.sources,
        },
        interactionId: generated.interactionId,
        endpoint: generated.endpoint,
        model: geminiStatus().model,
        period: plan.window.label,
        conversationId,
        generatedAt,
      };
    } catch (caught: any) {
      throw caught;
    }
  }

  async getHistory(userId: number, limitCount?: number, conversationId?: string): Promise<{ data: AiHistoryEntry[]; total: number }> {
    const limit = Math.min(100, Math.max(1, Number(limitCount || 50)));
    const filtered = memoryHistory
      .filter(item => item.userId === userId && (!conversationId || item.conversationId === conversationId))
      .slice(-limit)
      .reverse();

    return { data: filtered, total: filtered.length };
  }

  async generateWeeklyReport(userId: number, userRole: string, convId?: string) {
    enforceRateLimit(userId);
    const role = safeRole(userRole) as 'OWNER' | 'FINANCE';
    const conversationId = convId || randomUUID();

    try {
      const context: any = await buildWeeklyBusinessReportContext(role);
      const generated = await generateWeeklyReport(context);
      const financial = context.financial || {};
      const outstanding = context.outstanding || {};
      const operations = context.operations || {};
      const generatedAt = new Date().toISOString();

      const report = {
        title: 'WORTHTOBUY Weekly Business Report',
        periodLabel: context.period,
        generatedAt,
        role,
        businessSummary: {
          totalRevenue: financial.omzet || 0,
          transactions: financial.transactionCount || 0,
          newCustomers: role === 'OWNER' ? financial.newCustomers || 0 : null,
          repeatCustomers: role === 'OWNER' ? financial.repeatCustomers || 0 : null,
        },
        financialHealth: {
          paymentsReceived: financial.cashIn || 0,
          outstanding: outstanding.totalOutstanding || 0,
          overdueInvoices: outstanding.overdueInvoiceCount || 0,
          expenses: financial.expenses || 0,
          capital: financial.capital || 0,
          refunds: financial.paidRefunds || 0,
          profit: financial.netProfit || 0,
          marginPercent: financial.netMarginPercent || 0,
        },
        operationalMetrics:
          role === 'OWNER'
            ? {
              pendingPurchase: operations.pendingPurchaseCount || 0,
              purchasedNotReady: operations.purchasedNotReadyCount || 0,
              waitingShipment: operations.waitingShipmentCount || 0,
              customerNotReceived: operations.customerNotReceivedCount || 0,
            }
            : null,
        comparison: context.comparison?.percentageChanges || {},
        executiveSummary: generated.data.executiveSummary,
        financialCommentary: generated.data.financialCommentary,
        operationalIssues: generated.data.operationalIssues || [],
        recommendations: (generated.data.recommendations || []).slice(0, 3),
        caveats: generated.data.caveats || [],
      };

      const sources =
        role === 'OWNER'
          ? ['invoice', 'payment', 'purchase', 'expense', 'refund', 'order', 'customer', 'order_item', 'shipment']
          : ['invoice', 'payment', 'purchase', 'expense', 'refund', 'order'];

      memoryHistory.push({
        id: nextHistoryId++,
        userId,
        action: 'AI_BUSINESS_REPORT',
        conversationId,
        role,
        modules: role === 'OWNER' ? ['financial', 'outstanding', 'operations', 'comparison'] : ['financial', 'outstanding', 'comparison'],
        sources,
        reportSummary: generated.data.executiveSummary.slice(0, 4000),
        createdAt: generatedAt,
      });

      return { report, conversationId, sources, generatedAt };
    } catch (caught: any) {
      throw caught;
    }
  }

  async getBusinessSummary(userId: number, userRole: string) {
    enforceRateLimit(userId);
    const role = safeRole(userRole);
    const plan = createAiQueryPlan('Buat ringkasan bisnis, risiko, dan tindakan prioritas bulan ini.', role);
    const snapshot = await buildAiContext(plan, role);
    const generated = await generateChatAnswer('Buat ringkasan eksekutif, temuan utama, risiko, dan tindakan prioritas.', snapshot, []);
    const summary = formatAnswer(generated.data);

    return { summary, snapshot, model: geminiStatus().model, generatedAt: new Date().toISOString() };
  }
}
