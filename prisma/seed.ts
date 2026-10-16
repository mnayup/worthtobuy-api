import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:P@ssw0rd@localhost:5435/worthtobuy_db?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULT_SETTINGS = [
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
  { key: 'features', value: { darkMode: false, whatsapp: false, googleSheets: false } },
];

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
      'ai-assistant:view',
      'ai-assistant:chat',
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
      'refunds:create',
      'refunds:edit',
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

async function main() {
  console.log('Seeding WORTHTOBUY database...');
  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description, can_view_profit: role.can_view_profit, permissions: role.permissions },
      create: { name: role.name, description: role.description, can_view_profit: role.can_view_profit, permissions: role.permissions },
    });
  }

  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'OWNER' } });
  const ownerEmail = (process.env.OWNER_EMAIL || 'owner@worthtobuy.local').toLowerCase();
  const ownerUsername = 'owner';
  const password_hash = await bcrypt.hash(process.env.OWNER_PASSWORD || 'GantiPassword123!', 10);

  const existingOwner = await prisma.user.findFirst({
    where: {
      OR: [
        { email: ownerEmail },
        { username: ownerUsername },
      ],
    },
  });

  if (existingOwner) {
    await prisma.user.update({
      where: { id: existingOwner.id },
      data: {
        username: existingOwner.username || ownerUsername,
        email: existingOwner.email || ownerEmail,
        is_active: true,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        name: process.env.OWNER_NAME || 'Owner WORTHTOBUY',
        username: ownerUsername,
        email: ownerEmail,
        password_hash,
        role_id: ownerRole.id,
        is_active: true,
      },
    });
  }

  await prisma.currency.upsert({
    where: { code: 'IDR' },
    update: { name: 'Indonesian Rupiah', symbol: 'Rp', is_active: true },
    create: { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  });

  const rateCount = await prisma.exchange_rate.count({ where: { currency_code: 'IDR' } });
  if (rateCount === 0) {
    await prisma.exchange_rate.create({
      data: { currency_code: 'IDR', rate_to_idr: 1, effective_at: new Date(), source: 'Initial Seed' },
    });
  }

  for (const setting of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value as any },
      create: { key: setting.key, value: setting.value as any },
    });
  }

  // Seed rigid relational models
  const brandVal = DEFAULT_SETTINGS.find((s) => s.key === 'brand')?.value as any;
  if (brandVal) {
    const existingBrand = await prisma.brand_setting.findFirst();
    if (existingBrand) {
      await prisma.brand_setting.update({
        where: { id: existingBrand.id },
        data: {
          name: brandVal.name,
          tagline: brandVal.tagline,
          whatsapp: brandVal.whatsapp,
          instagram: brandVal.instagram,
          instagram_url: brandVal.instagramUrl,
          primary_color: brandVal.primaryColor,
          logo_url: brandVal.logoUrl,
        },
      });
    } else {
      await prisma.brand_setting.create({
        data: {
          name: brandVal.name,
          tagline: brandVal.tagline,
          whatsapp: brandVal.whatsapp,
          instagram: brandVal.instagram,
          instagram_url: brandVal.instagramUrl,
          primary_color: brandVal.primaryColor,
          logo_url: brandVal.logoUrl,
        },
      });
    }
  }

  const invoiceVal = DEFAULT_SETTINGS.find((s) => s.key === 'invoice')?.value as any;
  if (invoiceVal) {
    const existingInvoice = await prisma.invoice_setting.findFirst();
    if (existingInvoice) {
      await prisma.invoice_setting.update({
        where: { id: existingInvoice.id },
        data: {
          prefix: invoiceVal.prefix,
          business_name: invoiceVal.businessName,
          whatsapp: invoiceVal.whatsapp,
          email: invoiceVal.email,
          address: invoiceVal.address,
          bank_name: invoiceVal.bankName,
          account_number: invoiceVal.accountNumber,
          account_holder: invoiceVal.accountHolder,
          footer: invoiceVal.footer,
        },
      });
    } else {
      await prisma.invoice_setting.create({
        data: {
          prefix: invoiceVal.prefix,
          business_name: invoiceVal.businessName,
          whatsapp: invoiceVal.whatsapp,
          email: invoiceVal.email,
          address: invoiceVal.address,
          bank_name: invoiceVal.bankName,
          account_number: invoiceVal.accountNumber,
          account_holder: invoiceVal.accountHolder,
          footer: invoiceVal.footer,
        },
      });
    }
  }

  console.log('Database seeded successfully.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
