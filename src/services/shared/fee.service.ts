import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

export type FeeRule = {
  id: string;
  label: string;
  min: number;
  max: number | null;
  type: 'FIXED' | 'PERCENT';
  value: number;
  active?: boolean;
};

export const DEFAULT_FEE_RULES: FeeRule[] = [
  { id: 'fee-01', label: '≤ Rp10.000', min: 0, max: 10_000, type: 'FIXED', value: 3_000, active: true },
  { id: 'fee-02', label: 'Rp10.001 – Rp49.000', min: 10_001, max: 49_000, type: 'FIXED', value: 6_000, active: true },
  { id: 'fee-03', label: 'Rp49.001 – Rp99.000', min: 49_001, max: 99_000, type: 'FIXED', value: 10_000, active: true },
  { id: 'fee-04', label: 'Rp99.001 – Rp199.000', min: 99_001, max: 199_000, type: 'FIXED', value: 15_000, active: true },
  { id: 'fee-05', label: 'Rp199.001 – Rp299.000', min: 199_001, max: 299_000, type: 'FIXED', value: 20_000, active: true },
  { id: 'fee-06', label: 'Rp299.001 – Rp399.000', min: 299_001, max: 399_000, type: 'FIXED', value: 25_000, active: true },
  { id: 'fee-07', label: 'Rp399.001 – Rp499.000', min: 399_001, max: 499_000, type: 'FIXED', value: 30_000, active: true },
  { id: 'fee-08', label: 'Rp499.001 – Rp599.000', min: 499_001, max: 599_000, type: 'FIXED', value: 35_000, active: true },
  { id: 'fee-09', label: 'Rp599.001 – Rp699.000', min: 599_001, max: 699_000, type: 'FIXED', value: 40_000, active: true },
  { id: 'fee-10', label: '> Rp699.000', min: 699_001, max: null, type: 'PERCENT', value: 7, active: true },
];

function normaliseRules(value: unknown): FeeRule[] {
  if (!Array.isArray(value)) return DEFAULT_FEE_RULES;
  const rules = value
    .map((rule: any, index) => ({
      id: String(rule?.id || `fee-${String(index + 1).padStart(2, '0')}`),
      label: String(rule?.label || ''),
      min: Math.max(0, Number(rule?.min || 0)),
      max: rule?.max === null || rule?.max === '' || rule?.max === undefined ? null : Math.max(0, Number(rule.max)),
      type: rule?.type === 'PERCENT' ? ('PERCENT' as const) : ('FIXED' as const),
      value: Math.max(0, Number(rule?.value || 0)),
      active: rule?.active !== false,
    }))
    .filter(rule => Number.isFinite(rule.min) && Number.isFinite(rule.value))
    .sort((a, b) => a.min - b.min);
  return rules.length ? rules : DEFAULT_FEE_RULES;
}

@Injectable()
export class FeeService {
  constructor(private prisma: PrismaService) { }

  async getFeeRules(type: 'CUSTOMER' | 'RESELLER' | 'AUTO_CUSTOMER' | 'AUTO_RESELLER' | string = 'CUSTOMER'): Promise<FeeRule[]> {
    const isReseller = type === 'RESELLER' || type === 'AUTO_RESELLER';
    const key = isReseller ? 'feeRulesReseller' : 'feeRules';
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting?.value && isReseller) {
      const fallbackSetting = await this.prisma.setting.findUnique({ where: { key: 'feeRules' } });
      return normaliseRules(fallbackSetting?.value);
    }
    return normaliseRules(setting?.value);
  }

  calculateServiceFee(amount: number, rules: FeeRule[]) {
    const safeAmount = Math.max(0, Number(amount || 0));
    const activeRules = rules.filter(rule => rule.active !== false).sort((a, b) => a.min - b.min);
    const matched =
      activeRules.find(rule => safeAmount >= rule.min && (rule.max === null || safeAmount <= rule.max)) ||
      activeRules[activeRules.length - 1] ||
      DEFAULT_FEE_RULES[0];
    const fee = matched.type === 'PERCENT' ? safeAmount * (matched.value / 100) : matched.value;
    return { fee: Math.round(fee), rule: matched };
  }

  calculateItemsServiceFee(items: Array<Record<string, any>>, rules: FeeRule[]) {
    let totalFee = 0;
    const itemBreakdown: Array<{ unitPrice: number; quantity: number; unitFee: number; totalFee: number; rule: FeeRule }> = [];

    for (const item of items) {
      const unitPrice = Number(
        item.unit_price_foreign ??
        item.unitPriceForeign ??
        item.target_price_idr ??
        item.targetPriceIdr ??
        item.price ??
        0
      );
      const qty = Math.max(1, Number(item.quantity || 1));
      const { fee: unitFee, rule } = this.calculateServiceFee(unitPrice, rules);
      const subtotalFee = unitFee * qty;
      totalFee += subtotalFee;
      itemBreakdown.push({ unitPrice, quantity: qty, unitFee, totalFee: subtotalFee, rule });
    }

    return {
      fee: Math.round(totalFee),
      itemBreakdown,
    };
  }
}
