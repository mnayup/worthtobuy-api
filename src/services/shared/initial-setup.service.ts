import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../config/prisma/prisma.service';

export const DEFAULT_SETTINGS = [
  {
    key: 'brand',
    value: {
      name: process.env.BRAND_NAME || 'WORTHTOBUY',
      tagline: process.env.BRAND_TAGLINE || 'Your Trusted Jastip Bestie & Personal Shopper Nasional',
      whatsapp: process.env.BRAND_WHATSAPP || '6285186852535',
      instagram: process.env.BRAND_INSTAGRAM || '@worthtobuy_sub',
      instagramUrl: process.env.BRAND_INSTAGRAM_URL || 'https://www.instagram.com/worthtobuy_sub',
      primaryColor: '#b7332b',
      secondaryColor: '#B8322C',
      accentColor: '#F3C32F',
      logoUrl: '/worthtobuy-logo.png',
    },
  },
  {
    key: 'invoice',
    value: {
      prefix: 'WTB-INV',
      businessName: process.env.BRAND_NAME || 'WORTHTOBUY',
      whatsapp: process.env.BRAND_WHATSAPP || '6285186852535',
      email: '',
      address: '',
      bankName: process.env.DEFAULT_BANK_NAME || 'BCA (Bank Central Asia)',
      accountNumber: process.env.DEFAULT_BANK_ACCOUNT || '1234567890',
      accountHolder: process.env.DEFAULT_BANK_HOLDER || 'WORTHTOBUY',
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
  {
    name: 'OWNER',
    description: 'Super Administrator dengan akses penuh tanpa batas ke semua menu dan aksi.',
    can_view_profit: true,
    permissions: ['*'],
  },
  {
    name: 'ADMIN',
    description: 'Manajer Operasional & Master Data.',
    can_view_profit: false,
    permissions: [
      'dashboard:view',
      'periods:view',
      'periods:create',
      'periods:edit',
      'products:view',
      'products:create',
      'products:edit',
      'products:detail',
      'products:export',
      'customers:view',
      'customers:create',
      'customers:edit',
      'customers:detail',
      'customers:export',
      'orders:view',
      'orders:create',
      'orders:edit',
      'orders:detail',
      'orders:status',
      'orders:export',
      'purchases:view',
      'purchases:create',
      'purchases:edit',
      'purchases:detail',
      'shipments:view',
      'shipments:create',
      'shipments:edit',
      'shipments:detail',
      'shipments:dispatch',
      'invoices:view',
      'invoices:create',
      'invoices:detail',
      'payments:view',
      'payments:create',
      'refunds:view',
      'refunds:request',
    ],
  },
  {
    name: 'SHOPPER',
    description: 'Petugas Belanja & Tracking Barang Lapangan.',
    can_view_profit: false,
    permissions: [
      'dashboard:view',
      'periods:view',
      'products:view',
      'products:detail',
      'shopping-list:view',
      'shopping-list:purchase',
      'purchases:view',
      'purchases:create',
      'purchases:detail',
      'item-tracking:view',
      'item-tracking:edit',
    ],
  },
  {
    name: 'FINANCE',
    description: 'Petugas Keuangan, Pembayaran, Invoice, dan Laporan Laba Rugi.',
    can_view_profit: true,
    permissions: [
      'dashboard:view',
      'customers:view',
      'orders:view',
      'orders:detail',
      'invoices:view',
      'invoices:create',
      'invoices:edit',
      'invoices:detail',
      'invoices:send',
      'invoices:download',
      'payments:view',
      'payments:create',
      'payments:verify',
      'refunds:view',
      'refunds:request',
      'refunds:execute',
      'expenses:view',
      'expenses:create',
      'expenses:edit',
      'finance:view',
      'finance:export',
      'summary:view',
      'summary:calculate',
      'reports:view',
      'reports:export',
    ],
  },
];

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
        const existing = await this.prisma.role.findUnique({ where: { name: role.name } });
        if (!existing) {
          const created = await this.prisma.role.create({
            data: {
              name: role.name,
              description: role.description,
              can_view_profit: role.can_view_profit,
              permissions: [...role.permissions],
            },
          });
          roles.set(role.name, created);
        } else {
          // Preserve all existing custom permissions and settings configured by users.
          // Safety guard: ensure OWNER role always keeps '*' so administrator access is guaranteed.
          if (role.name === 'OWNER') {
            const currentPerms = Array.isArray(existing.permissions) ? (existing.permissions as string[]) : [];
            if (!currentPerms.includes('*')) {
              const updated = await this.prisma.role.update({
                where: { id: existing.id },
                data: { permissions: ['*', ...currentPerms], can_view_profit: true },
              });
              roles.set(role.name, updated);
            } else {
              roles.set(role.name, existing);
            }
          } else {
            roles.set(role.name, existing);
          }
        }
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

      // Backfill shipment_orders for existing shipments
      const existingShipments = await this.prisma.shipment.findMany({
        where: {
          shipment_orders: { none: {} },
        },
        select: { id: true, order_id: true },
      });
      for (const s of existingShipments) {
        if (s.order_id) {
          await this.prisma.shipment_order.upsert({
            where: {
              shipment_id_order_id: { shipment_id: s.id, order_id: s.order_id },
            },
            create: { shipment_id: s.id, order_id: s.order_id },
            update: {},
          });
        }
      }

      // Sync role_permissions table from existing role permissions JSON
      const allRoles = await this.prisma.role.findMany();
      for (const r of allRoles) {
        const perms: string[] = Array.isArray(r.permissions) ? (r.permissions as string[]) : [];
        if (perms.length > 0) {
          await this.prisma.role_permission.createMany({
            data: perms.map((p) => ({ role_id: r.id, permission: p })),
            skipDuplicates: true,
          });
        }
      }

      // Seed / Ensure default navigation items in database
      await this.seedNavigationItems();
    } catch (err) {
      this.logger.error('Error during initial setup:', err);
    }
  }

  private async seedNavigationItems() {
    const defaultNavStructure = [
      {
        key: 'dashboard',
        label: 'Dashboard',
        path: '/dashboard',
        icon: 'LayoutDashboard',
        group_title: 'Main',
        sort_order: 10,
        permission_key: 'dashboard:view',
      },
      {
        key: 'periods',
        label: 'Events',
        path: '/periods',
        icon: 'ClipboardList',
        group_title: 'Master Data',
        sort_order: 20,
        permission_key: 'periods:view',
      },
      {
        key: 'products',
        label: 'Products',
        path: '/products',
        icon: 'Boxes',
        group_title: 'Master Data',
        sort_order: 21,
        permission_key: 'products:view',
      },
      {
        key: 'customers',
        label: 'Customers',
        path: '/customers',
        icon: 'Users',
        group_title: 'Master Data',
        sort_order: 22,
        permission_key: 'customers:view',
      },
      {
        key: 'whatsapp-groups',
        label: 'WhatsApp Groups',
        path: '/whatsapp-groups',
        icon: 'MessageCircle',
        group_title: 'Master Data',
        sort_order: 23,
        permission_key: 'whatsapp-groups:view',
      },
      {
        key: 'shipping-counters',
        label: 'Shipping Couriers',
        path: '/shipping-counters',
        icon: 'Truck',
        group_title: 'Master Data',
        sort_order: 24,
        permission_key: 'shipping-counters:view',
      },
      {
        key: 'orders',
        label: 'Orders',
        path: '/orders',
        icon: 'ReceiptText',
        group_title: 'Operations',
        sort_order: 30,
        permission_key: 'orders:view',
      },
      {
        key: 'purchases',
        label: 'Purchases',
        path: '/purchases',
        icon: 'ShoppingBag',
        group_title: 'Operations',
        sort_order: 31,
        permission_key: 'purchases:view',
      },
      {
        key: 'shipments',
        label: 'Shipments',
        path: '/shipments',
        icon: 'Truck',
        group_title: 'Operations',
        sort_order: 32,
        permission_key: 'shipments:view',
      },
      {
        key: 'keep-items',
        label: 'Keep Items',
        path: '/keep-items',
        icon: 'Archive',
        group_title: 'Operations',
        sort_order: 33,
        permission_key: 'keep-items:view',
      },
      {
        key: 'invoices',
        label: 'Invoices & Billing',
        path: '/invoices',
        icon: 'FileText',
        group_title: 'Finance',
        sort_order: 40,
        permission_key: 'invoices:view',
        sub_items: [
          {
            key: 'invoices-list',
            label: 'Customer Invoices',
            path: '/invoices',
            icon: 'FileText',
            group_title: 'Finance',
            sort_order: 41,
            permission_key: 'invoices:view',
          },
          {
            key: 'payments-list',
            label: 'Payment History',
            path: '/payments',
            icon: 'CircleDollarSign',
            group_title: 'Finance',
            sort_order: 42,
            permission_key: 'payments:view',
          },
          {
            key: 'refunds-list',
            label: 'Refunds',
            path: '/refunds',
            icon: 'RotateCcw',
            group_title: 'Finance',
            sort_order: 43,
            permission_key: 'refunds:view',
          },
        ],
      },
      {
        key: 'expenses',
        label: 'Expenses',
        path: '/expenses',
        icon: 'CircleDollarSign',
        group_title: 'Finance',
        sort_order: 44,
        permission_key: 'expenses:view',
      },
      {
        key: 'finance',
        label: 'Cash Flow & Reports',
        path: '/finance',
        icon: 'Landmark',
        group_title: 'Finance',
        sort_order: 45,
        permission_key: 'finance:view',
        sub_items: [
          {
            key: 'finance-overview',
            label: 'Cash Flow Overview',
            path: '/finance',
            icon: 'Landmark',
            group_title: 'Finance',
            sort_order: 46,
            permission_key: 'finance:view',
          },
          {
            key: 'summary-fees',
            label: 'Summary & Fees',
            path: '/summary',
            icon: 'Calculator',
            group_title: 'Finance',
            sort_order: 47,
            permission_key: 'summary:view',
          },
          {
            key: 'profit-loss-reports',
            label: 'Profit & Loss Report',
            path: '/reports',
            icon: 'FileBarChart2',
            group_title: 'Finance',
            sort_order: 48,
            permission_key: 'reports:view',
          },
        ],
      },
      {
        key: 'users',
        label: 'User Management',
        path: '/users',
        icon: 'UserCog',
        group_title: 'System',
        sort_order: 50,
        permission_key: 'users:view',
      },
      {
        key: 'roles',
        label: 'Role & Permissions',
        path: '/roles',
        icon: 'ShieldCheck',
        group_title: 'System',
        sort_order: 51,
        permission_key: 'roles:view',
      },
      {
        key: 'settings',
        label: 'System Settings',
        path: '/settings',
        icon: 'Settings',
        group_title: 'System',
        sort_order: 52,
        permission_key: 'settings:view',
      },
      {
        key: 'trash',
        label: 'Trash / Bin',
        path: '/trash',
        icon: 'Trash2',
        group_title: 'System',
        sort_order: 53,
        permission_key: 'trash:view',
      },
    ];

    for (const item of defaultNavStructure) {
      const parent = await this.prisma.navigation_item.upsert({
        where: { key: item.key },
        update: {
          label: item.label,
          path: item.path,
          icon: item.icon,
          group_title: item.group_title,
          sort_order: item.sort_order,
          permission_key: item.permission_key,
        },
        create: {
          key: item.key,
          label: item.label,
          path: item.path,
          icon: item.icon,
          group_title: item.group_title,
          sort_order: item.sort_order,
          permission_key: item.permission_key,
        },
      });

      if (item.sub_items && item.sub_items.length > 0) {
        for (const sub of item.sub_items) {
          await this.prisma.navigation_item.upsert({
            where: { key: sub.key },
            update: {
              label: sub.label,
              path: sub.path,
              icon: sub.icon,
              group_title: sub.group_title,
              sort_order: sub.sort_order,
              parent_id: parent.id,
              permission_key: sub.permission_key,
            },
            create: {
              key: sub.key,
              label: sub.label,
              path: sub.path,
              icon: sub.icon,
              group_title: sub.group_title,
              sort_order: sub.sort_order,
              parent_id: parent.id,
              permission_key: sub.permission_key,
            },
          });
        }
      }
    }
  }
}
