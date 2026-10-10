import { serializeData as serialize } from '../../common/interceptors/serialize.interceptor';
import {
  AiRole,
  AiQueryPlan,
  rollingWindow,
  createAiQueryPlan,
} from './helpers/ai-planner.helper';
import {
  financialSummary,
  outstandingSummary,
  comparisonSummary,
} from './helpers/ai-financial-summaries.helper';
import {
  customerIntelligence,
  productIntelligence,
  eventPerformance,
  operationsIntelligence,
} from './helpers/ai-operational-summaries.helper';

export {
  AiRole,
  AiIntent,
  DateWindow,
  AiQueryPlan,
  createAiQueryPlan,
} from './helpers/ai-planner.helper';

function stripCustomerMetrics(value: any) {
  if (!value || typeof value !== 'object') return value;
  const { newCustomers: _newCustomers, repeatCustomers: _repeatCustomers, uniqueCustomers: _uniqueCustomers, ...safe } = value;
  return safe;
}

function stripCustomerComparisonMetrics(value: any) {
  if (!value || typeof value !== 'object') return value;
  const changes = value.percentageChanges && typeof value.percentageChanges === 'object'
    ? stripCustomerMetrics(value.percentageChanges)
    : value.percentageChanges;
  return {
    ...value,
    current: stripCustomerMetrics(value.current),
    previous: stripCustomerMetrics(value.previous),
    percentageChanges: changes,
  };
}

export async function buildAiContext(plan: AiQueryPlan, role: AiRole) {
  const context: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Jakarta',
    role,
    intent: plan.intent,
    requestedPeriod: plan.window.label,
    accessScope: role === 'OWNER'
      ? 'Data bisnis lengkap yang relevan, tanpa password, API key, token, atau audit keamanan.'
      : role === 'FINANCE'
        ? 'Invoice, pembayaran, outstanding, pengeluaran, refund, dan laporan keuangan. Tidak mencakup customer intelligence, produk, atau operasional non-keuangan.'
        : 'Pesanan, customer, produk, tracking, dan pengiriman. Tidak mencakup profit, modal, pengeluaran, refund, atau laporan owner.',
  };

  for (const module of plan.modules) {
    if (module === 'financial') {
      const financial = await financialSummary(plan.window);
      context.financial = role === 'FINANCE' ? stripCustomerMetrics(financial) : financial;
    }
    if (module === 'outstanding') context.outstanding = await outstandingSummary();
    if (module === 'customers') context.customerIntelligence = await customerIntelligence(plan.window);
    if (module === 'products') context.productIntelligence = await productIntelligence(plan.window);
    if (module === 'events') context.eventPerformance = await eventPerformance();
    if (module === 'operations') context.operations = await operationsIntelligence();
    if (module === 'comparison') {
      const comparison = await comparisonSummary(plan.window);
      context.comparison = role === 'FINANCE' ? stripCustomerComparisonMetrics(comparison) : comparison;
    }
  }

  return serialize(context);
}

export async function buildWeeklyBusinessReportContext(role: 'OWNER' | 'FINANCE') {
  const current = rollingWindow(7);
  const rawFinancial = await financialSummary(current);
  const rawComparison = await comparisonSummary(current);
  const outstanding = await outstandingSummary();
  const financial = role === 'FINANCE' ? stripCustomerMetrics(rawFinancial) : rawFinancial;
  const comparison = role === 'FINANCE' ? stripCustomerComparisonMetrics(rawComparison) : rawComparison;
  const context: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Jakarta',
    role,
    period: current.label,
    financial,
    comparison,
    outstanding,
  };
  if (role === 'OWNER') context.operations = await operationsIntelligence();
  return serialize(context);
}
