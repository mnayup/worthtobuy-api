import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { sequence } from '../../common/utils/http.utils';

function cleanExpenseData(body: any): any {
  if (!body || typeof body !== 'object') return {};
  const cleaned: any = {};

  if (body.expense_number !== undefined || body.expenseNumber !== undefined) {
    const val = body.expense_number !== undefined ? body.expense_number : body.expenseNumber;
    cleaned.expense_number = val ? String(val).trim() : undefined;
  }
  if (body.expense_date !== undefined || body.expenseDate !== undefined) {
    const val = body.expense_date !== undefined ? body.expense_date : body.expenseDate;
    cleaned.expense_date = val ? new Date(val) : new Date();
  }
  if (body.category !== undefined) {
    cleaned.category = String(body.category).trim();
  }
  if (body.period_id !== undefined || body.periodId !== undefined) {
    const val = body.period_id !== undefined ? body.period_id : body.periodId;
    cleaned.period_id = val ? Number(val) : null;
  }
  if (body.amount !== undefined) {
    cleaned.amount = Number(body.amount);
    cleaned.amount_idr = Number(body.amount_idr ?? body.amountIdr ?? body.amount);
  }
  if (body.payee !== undefined) {
    cleaned.payee = body.payee ? String(body.payee).trim() : null;
  }
  if (body.payment_method !== undefined || body.paymentMethod !== undefined) {
    const val = body.payment_method !== undefined ? body.payment_method : body.paymentMethod;
    cleaned.payment_method = val ? String(val).trim() : null;
  }
  if (
    body.proof_url !== undefined ||
    body.proofUrl !== undefined ||
    body.receipt_url !== undefined ||
    body.receiptUrl !== undefined
  ) {
    const val =
      body.proof_url !== undefined
        ? body.proof_url
        : body.proofUrl !== undefined
        ? body.proofUrl
        : body.receipt_url !== undefined
        ? body.receipt_url
        : body.receiptUrl;
    cleaned.proof_url = val ? String(val).trim() : null;
  }
  if (body.notes !== undefined) {
    cleaned.notes = body.notes ? String(body.notes).trim() : null;
  }

  return cleaned;
}

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) { }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const period_id = query.period_id ? Number(query.period_id) : query.periodId ? Number(query.periodId) : undefined;
    const search = String(query.search || '').trim().slice(0, 100);
    const category = query.category && query.category !== 'ALL' ? String(query.category) : undefined;
    const paymentMethodQuery = query.payment_method || query.paymentMethod;
    const payment_method = paymentMethodQuery && paymentMethodQuery !== 'ALL' ? String(paymentMethodQuery) : undefined;

    const where: any = {
      deleted_at: null,
      ...(period_id ? { period_id } : {}),
      ...(category ? { category: { contains: category, mode: 'insensitive' } } : {}),
      ...(payment_method ? { payment_method: { contains: payment_method, mode: 'insensitive' } } : {}),
      ...(search
        ? {
          OR: [
            { expense_number: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } },
            { payee: { contains: search, mode: 'insensitive' } },
            { payment_method: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
            { period: { code: { contains: search, mode: 'insensitive' } } },
            { period: { name: { contains: search, mode: 'insensitive' } } },
            { period: { city: { contains: search, mode: 'insensitive' } } },
          ],
        }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({ where, skip, take: limit, orderBy: { expense_date: 'desc' }, include: { period: true } }),
      this.prisma.expense.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async create(body: any) {
    const cleaned = cleanExpenseData(body);
    return this.prisma.expense.create({
      data: {
        ...cleaned,
        expense_number: cleaned.expense_number || sequence('EXP'),
        currency_code: 'IDR',
        exchange_rate: 1,
        amount_idr: cleaned.amount_idr ?? cleaned.amount,
      },
    });
  }

  async update(id: number, body: any) {
    const current = await this.prisma.expense.findUniqueOrThrow({ where: { id } });
    const cleaned = cleanExpenseData(body);
    const amount = cleaned.amount !== undefined ? Number(cleaned.amount) : Number(current.amount);
    return this.prisma.expense.update({
      where: { id: current.id },
      data: {
        ...cleaned,
        currency_code: 'IDR',
        exchange_rate: 1,
        amount,
        amount_idr: cleaned.amount_idr ?? amount,
      },
    });
  }

  async remove(id: number, user_id?: number) {
    return this.prisma.expense.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });
  }
}

