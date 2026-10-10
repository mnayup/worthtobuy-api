import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { sequence } from '../../common/utils/http.utils';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) { }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const period_id = query.period_id ? Number(query.period_id) : undefined;
    const search = String(query.search || '').trim().slice(0, 100);
    const category = query.category && query.category !== 'ALL' ? String(query.category) : undefined;
    const payment_method = query.payment_method && query.payment_method !== 'ALL' ? String(query.payment_method) : undefined;

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
    return this.prisma.expense.create({
      data: {
        ...body,
        expense_number: body.expense_number || sequence('EXP'),
        currency_code: 'IDR',
        exchange_rate: 1,
        amount_idr: body.amount,
      },
    });
  }

  async update(id: number, body: any) {
    const current = await this.prisma.expense.findUniqueOrThrow({ where: { id } });
    const amount = Number(body.amount ?? current.amount);
    return this.prisma.expense.update({
      where: { id: current.id },
      data: { ...body, currency_code: 'IDR', exchange_rate: 1, amount_idr: amount },
    });
  }

  async remove(id: number, user_id?: number) {
    return this.prisma.expense.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by_id: user_id },
    });
  }
}
