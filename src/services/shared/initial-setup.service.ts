import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../config/prisma/prisma.service';

export const DEFAULT_SETTINGS = [
  {
    key: 'brand',
    value: {
      name: 'WORTHTOBUY',
      tagline: 'Your trusted jastip bestie',
      primaryColor: '#9A633B',
      secondaryColor: '#B8322C',
      accentColor: '#F3C32F',
      logoUrl: '/worthtobuy-logo.png',
    },
  },
  {
    key: 'invoice',
    value: {
      prefix: 'WTB-INV',
      businessName: 'WORTHTOBUY',
      whatsapp: '',
      email: '',
      address: '',
      bankName: '',
      accountNumber: '',
      accountHolder: '',
      footer: 'Terima kasih sudah belanja bersama WORTHTOBUY. Simpan invoice ini sebagai bukti transaksi.',
    },
  },
  {
    key: 'feeRules',
    value: [
      { id: 'fee-01', label: '≤ Rp10.000', min: 0, max: 10000, type: 'FIXED', value: 3000, active: true },
      { id: 'fee-02', label: 'Rp10.001 – Rp49.000', min: 10001, max: 49000, type: 'FIXED', value: 6000, active: true },
      { id: 'fee-03', label: 'Rp49.001 – Rp99.000', min: 49001, max: 99000, type: 'FIXED', value: 10000, active: true },
      { id: 'fee-04', label: 'Rp99.001 – Rp199.000', min: 99001, max: 199000, type: 'FIXED', value: 15000, active: true },
      { id: 'fee-05', label: 'Rp199.001 – Rp299.000', min: 199001, max: 299000, type: 'FIXED', value: 20000, active: true },
      { id: 'fee-06', label: 'Rp299.001 – Rp399.000', min: 299001, max: 399000, type: 'FIXED', value: 25000, active: true },
      { id: 'fee-07', label: 'Rp399.001 – Rp499.000', min: 399001, max: 499000, type: 'FIXED', value: 30000, active: true },
      { id: 'fee-08', label: 'Rp499.001 – Rp599.000', min: 499001, max: 599000, type: 'FIXED', value: 35000, active: true },
      { id: 'fee-09', label: 'Rp599.001 – Rp699.000', min: 599001, max: 699000, type: 'FIXED', value: 40000, active: true },
      { id: 'fee-10', label: '> Rp699.000', min: 699001, max: null, type: 'PERCENT', value: 7, active: true },
    ],
  },
    {
    key: 'feeRulesReseller',
    value: [
      { id: 'fee-res-01', label: '≤ Rp10.000', min: 0, max: 10000, type: 'FIXED', value: 2000, active: true },
      { id: 'fee-res-02', label: 'Rp10.001 – Rp49.000', min: 10001, max: 49000, type: 'FIXED', value: 4000, active: true },
      { id: 'fee-res-03', label: 'Rp49.001 – Rp99.000', min: 49001, max: 99000, type: 'FIXED', value: 7000, active: true },
      { id: 'fee-res-04', label: 'Rp99.001 – Rp199.000', min: 99001, max: 199000, type: 'FIXED', value: 10000, active: true },
      { id: 'fee-res-05', label: 'Rp199.001 – Rp299.000', min: 199001, max: 299000, type: 'FIXED', value: 15000, active: true },
      { id: 'fee-res-06', label: 'Rp299.001 – Rp399.000', min: 299001, max: 399000, type: 'FIXED', value: 18000, active: true },
      { id: 'fee-res-07', label: 'Rp399.001 – Rp499.000', min: 399001, max: 499000, type: 'FIXED', value: 22000, active: true },
      { id: 'fee-res-08', label: 'Rp499.001 – Rp599.000', min: 499001, max: 599000, type: 'FIXED', value: 25000, active: true },
      { id: 'fee-res-09', label: 'Rp599.001 – Rp699.000', min: 599001, max: 699000, type: 'FIXED', value: 30000, active: true },
      { id: 'fee-res-10', label: '> Rp699.000', min: 699001, max: null, type: 'PERCENT', value: 5, active: true },
    ],
  },
  { key: 'features', value: { darkMode: false, whatsapp: false, googleSheets: false } },
] as const;

const DEFAULT_ROLES = [
  { name: 'OWNER', can_view_profit: true, permissions: ['*'] },
  { name: 'ADMIN', can_view_profit: false, permissions: ['customers', 'orders', 'payments', 'purchases', 'shipments'] },
  { name: 'SHOPPER', can_view_profit: false, permissions: ['shopping-list', 'purchases'] },
  { name: 'FINANCE', can_view_profit: true, permissions: ['payments', 'expenses', 'refunds', 'reports'] },
] as const;

@Injectable()
export class InitialSetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitialSetupService.name);

  constructor(private prisma: PrismaService) { }

  async onApplicationBootstrap() {
    await this.ensureInitialSetup();
  }

  async ensureInitialSetup() {
    try {
      const ownerName = process.env.OWNER_NAME || 'Owner WORTHTOBUY';
      const ownerEmail = (process.env.OWNER_EMAIL || 'owner@worthtobuy.local').toLowerCase();
      const ownerPassword = process.env.OWNER_PASSWORD || 'GantiPassword123!';

      const roles = new Map<string, any>();
      for (const role of DEFAULT_ROLES) {
        const saved = await this.prisma.role.upsert({
          where: { name: role.name },
          update: { can_view_profit: role.can_view_profit, permissions: [...role.permissions] },
          create: { name: role.name, can_view_profit: role.can_view_profit, permissions: [...role.permissions] },
        });
        roles.set(role.name, saved);
      }

      const userCount = await this.prisma.user.count();
      if (userCount === 0) {
        const password_hash = await bcrypt.hash(ownerPassword, 10);
        await this.prisma.user.create({
          data: {
            name: ownerName,
            email: ownerEmail,
            password_hash,
            role_id: roles.get('OWNER').id,
          },
        });
        this.logger.log(`Instalasi bersih aktif. Akun owner dibuat: ${ownerEmail}`);
      }

      await this.prisma.currency.upsert({
        where: { code: 'IDR' },
        update: { name: 'Indonesian Rupiah', symbol: 'Rp', is_active: true },
        create: { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
      });

      const rateCount = await this.prisma.exchange_rate.count({ where: { currency_code: 'IDR' } });
      if (rateCount === 0) {
        await this.prisma.exchange_rate.create({
          data: { currency_code: 'IDR', rate_to_idr: 1, effective_at: new Date(), source: 'Initial clean setup' },
        });
      }

      for (const setting of DEFAULT_SETTINGS) {
        const exists = await this.prisma.setting.findUnique({ where: { key: setting.key } });
        if (!exists) {
          await this.prisma.setting.create({ data: { key: setting.key, value: setting.value as any } });
        }
      }
    } catch (err) {
      this.logger.error('Error during initial setup:', err);
    }
  }
}
