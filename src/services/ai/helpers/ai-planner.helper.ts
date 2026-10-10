export type AiRole = 'OWNER' | 'FINANCE' | 'ADMIN';
export type AiIntent =
  | 'SECURITY_RESTRICTED'
  | 'REVENUE'
  | 'OUTSTANDING'
  | 'TOP_CUSTOMERS'
  | 'TOP_PRODUCTS'
  | 'EVENT_PERFORMANCE'
  | 'OPERATIONS'
  | 'ITEM_TRACKING'
  | 'NET_PROFIT'
  | 'PERIOD_COMPARISON'
  | 'BUSINESS_OVERVIEW';

export type DateWindow = {
  label: string;
  start?: Date;
  end?: Date;
  previousStart?: Date;
  previousEnd?: Date;
};

export type AiQueryPlan = {
  intent: AiIntent;
  modules: string[];
  sources: string[];
  window: DateWindow;
  deniedReason?: string;
};

export const TOP_LIMIT = Math.min(20, Math.max(3, Number(process.env.AI_CONTEXT_LIMIT || 10)));
const JAKARTA_OFFSET_HOURS = 7;

export const ROLE_INTENTS: Record<AiRole, AiIntent[]> = {
  OWNER: ['REVENUE', 'OUTSTANDING', 'TOP_CUSTOMERS', 'TOP_PRODUCTS', 'EVENT_PERFORMANCE', 'OPERATIONS', 'ITEM_TRACKING', 'NET_PROFIT', 'PERIOD_COMPARISON', 'BUSINESS_OVERVIEW'],
  FINANCE: ['REVENUE', 'OUTSTANDING', 'NET_PROFIT', 'PERIOD_COMPARISON', 'BUSINESS_OVERVIEW'],
  ADMIN: ['TOP_CUSTOMERS', 'TOP_PRODUCTS', 'OPERATIONS', 'ITEM_TRACKING', 'BUSINESS_OVERVIEW'],
};

export function normalizeQuestion(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function jakartaParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value || 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

export function jakartaDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - JAKARTA_OFFSET_HOURS, minute, 0, 0));
}

export function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000);
}

export function daysBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

export function currentMonthWindow(): DateWindow {
  const { year, month } = jakartaParts();
  const start = jakartaDate(year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = jakartaDate(nextYear, nextMonth, 1);
  const previousEnd = start;
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const previousStart = jakartaDate(previousYear, previousMonth, 1);
  return { label: 'bulan ini', start, end, previousStart, previousEnd };
}

export function lastMonthWindow(): DateWindow {
  const current = currentMonthWindow();
  const start = current.previousStart!;
  const end = current.previousEnd!;
  const span = daysBetween(start, end);
  return { label: 'bulan lalu', start, end, previousStart: addDays(start, -span), previousEnd: start };
}

export function currentWeekWindow(): DateWindow {
  const { year, month, day } = jakartaParts();
  const today = jakartaDate(year, month, day);
  const utcDay = new Date(today.getTime() + JAKARTA_OFFSET_HOURS * 3_600_000).getUTCDay();
  const daysSinceMonday = (utcDay + 6) % 7;
  const start = addDays(today, -daysSinceMonday);
  const end = addDays(start, 7);
  return { label: 'minggu ini', start, end, previousStart: addDays(start, -7), previousEnd: start };
}

export function lastWeekWindow(): DateWindow {
  const current = currentWeekWindow();
  const start = current.previousStart!;
  const end = current.previousEnd!;
  return { label: 'minggu lalu', start, end, previousStart: addDays(start, -7), previousEnd: start };
}

export function todayWindow(): DateWindow {
  const { year, month, day } = jakartaParts();
  const start = jakartaDate(year, month, day);
  const end = addDays(start, 1);
  return { label: 'hari ini', start, end, previousStart: addDays(start, -1), previousEnd: start };
}

export function rollingWindow(days: number): DateWindow {
  const { year, month, day } = jakartaParts();
  const end = addDays(jakartaDate(year, month, day), 1);
  const start = addDays(end, -days);
  return { label: `${days} hari terakhir`, start, end, previousStart: addDays(start, -days), previousEnd: start };
}

export function allTimeWindow(): DateWindow {
  return { label: 'seluruh periode' };
}

export function detectWindow(question: string, intent: AiIntent): DateWindow {
  if (/hari ini|today/.test(question)) return todayWindow();
  if (intent === 'PERIOD_COMPARISON' && /minggu ini|pekan ini/.test(question)) return currentWeekWindow();
  if (intent === 'PERIOD_COMPARISON' && /bulan ini/.test(question)) return currentMonthWindow();
  if (/minggu lalu|pekan lalu/.test(question)) return lastWeekWindow();
  if (/minggu ini|pekan ini/.test(question)) return currentWeekWindow();
  if (/bulan lalu/.test(question)) return lastMonthWindow();
  if (/bulan ini/.test(question)) return currentMonthWindow();
  const rolling = question.match(/(\d{1,3})\s*hari/);
  if (rolling) return rollingWindow(Math.min(365, Math.max(1, Number(rolling[1]))));
  if (['TOP_CUSTOMERS', 'TOP_PRODUCTS', 'EVENT_PERFORMANCE', 'OUTSTANDING', 'ITEM_TRACKING', 'OPERATIONS'].includes(intent)) return allTimeWindow();
  return currentMonthWindow();
}

export function detectIntent(question: string): AiIntent {
  if (/password|kata sandi|api key|secret|token jwt|audit security|log keamanan|hash/.test(question)) return 'SECURITY_RESTRICTED';
  if (/customer terbaik|pelanggan terbaik|customer terbesar|pelanggan terbesar|lifetime value|\bclv\b|customer ranking|ranking customer/.test(question)) return 'TOP_CUSTOMERS';
  if (/produk.*(paling laku|terlaris|paling banyak)|barang.*(paling laku|terlaris)|produk terbaik|margin produk/.test(question)) return 'TOP_PRODUCTS';
  if (/event.*(untung|profit|menguntungkan|performa)|periode.*(untung|profit|menguntungkan)/.test(question)) return 'EVENT_PERFORMANCE';
  if (/belum datang|belum dibeli|belum dikirim|belum menerima|tracking barang|track barang|status barang/.test(question)) return 'ITEM_TRACKING';
  if (/masalah operasional|prioritas operasional|operasional.*prioritas|barang terlambat|kendala operasional/.test(question)) return 'OPERATIONS';
  if (/belum lunas|outstanding|piutang|invoice overdue|jatuh tempo|invoice.*terlambat/.test(question)) return 'OUTSTANDING';
  if (/bandingkan|dibanding|lebih baik|naik atau turun|performa.*bulan|performa.*minggu/.test(question)) return 'PERIOD_COMPARISON';
  if (/keuntungan bersih|laba bersih|net profit|margin|modal|biaya operasional|pengeluaran/.test(question)) return 'NET_PROFIT';
  if (/omzet|revenue|pendapatan|penjualan|pembayaran masuk|cash in/.test(question)) return 'REVENUE';
  return 'BUSINESS_OVERVIEW';
}

export function modulesForIntent(intent: AiIntent, role: AiRole) {
  const base: Record<Exclude<AiIntent, 'SECURITY_RESTRICTED'>, { modules: string[]; sources: string[] }> = {
    REVENUE: { modules: ['financial'], sources: ['invoice', 'payment', 'order'] },
    OUTSTANDING: { modules: ['outstanding'], sources: ['invoice', 'customer'] },
    TOP_CUSTOMERS: { modules: ['customers'], sources: ['customer', 'invoice', 'order'] },
    TOP_PRODUCTS: { modules: ['products'], sources: ['product', 'order_item', 'purchase', 'event'] },
    EVENT_PERFORMANCE: { modules: ['events'], sources: ['event', 'invoice', 'purchase', 'expense', 'refund'] },
    OPERATIONS: { modules: ['operations'], sources: ['order_item', 'purchase', 'shipment', 'order', 'customer'] },
    ITEM_TRACKING: { modules: ['operations'], sources: ['order_item', 'purchase', 'shipment', 'order', 'customer'] },
    NET_PROFIT: { modules: ['financial'], sources: ['invoice', 'purchase', 'expense', 'refund', 'payment'] },
    PERIOD_COMPARISON: { modules: ['comparison'], sources: ['invoice', 'payment', 'purchase', 'expense', 'refund', 'order', 'customer'] },
    BUSINESS_OVERVIEW: role === 'OWNER'
      ? { modules: ['financial', 'outstanding', 'operations', 'customers', 'products', 'events'], sources: ['invoice', 'payment', 'purchase', 'expense', 'refund', 'order', 'customer', 'product', 'order_item', 'shipment', 'event'] }
      : role === 'FINANCE'
        ? { modules: ['financial', 'outstanding', 'comparison'], sources: ['invoice', 'payment', 'purchase', 'expense', 'refund', 'order', 'customer'] }
        : { modules: ['operations', 'customers', 'products'], sources: ['order', 'order_item', 'customer', 'product', 'purchase', 'shipment', 'event'] },
  };
  return base[intent as Exclude<AiIntent, 'SECURITY_RESTRICTED'>];
}

export function createAiQueryPlan(rawQuestion: string, role: string): AiQueryPlan {
  const normalized = normalizeQuestion(rawQuestion);
  const safeRole = (['OWNER', 'FINANCE', 'ADMIN'].includes(role) ? role : 'ADMIN') as AiRole;
  const intent = detectIntent(normalized);
  if (intent === 'SECURITY_RESTRICTED') {
    return {
      intent,
      modules: [],
      sources: [],
      window: allTimeWindow(),
      deniedReason: 'AI Assistant tidak dapat mengakses password, API key, token, hash, atau audit keamanan.',
    };
  }
  if (!ROLE_INTENTS[safeRole].includes(intent)) {
    return {
      intent,
      modules: [],
      sources: [],
      window: detectWindow(normalized, intent),
      deniedReason: `Role ${safeRole} tidak memiliki izin untuk data yang diminta.`,
    };
  }
  const { modules, sources } = modulesForIntent(intent, safeRole);
  return { intent, modules, sources: [...new Set(sources)], window: detectWindow(normalized, intent) };
}
