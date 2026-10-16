import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

export const DEFAULT_BRAND_CONFIG = {
  name: process.env.BRAND_NAME || 'WORTHTOBUY',
  tagline: process.env.BRAND_TAGLINE || 'Your Trusted Jastip Bestie & Personal Shopper Nasional',
  whatsapp: process.env.BRAND_WHATSAPP || '6285186852535',
  instagram: process.env.BRAND_INSTAGRAM || '@worthtobuy_sub',
  instagramUrl: process.env.BRAND_INSTAGRAM_URL || 'https://www.instagram.com/worthtobuy_sub',
  primaryColor: '#b7332b',
  logoUrl: '/worthtobuy-logo.png',
};

export const DEFAULT_INVOICE_CONFIG = {
  prefix: 'WTB-INV',
  businessName: process.env.BRAND_NAME || 'WORTHTOBUY',
  whatsapp: process.env.BRAND_WHATSAPP || '6285186852535',
  email: '',
  address: '',
  bankName: process.env.DEFAULT_BANK_NAME || 'BCA (Bank Central Asia)',
  accountNumber: process.env.DEFAULT_BANK_ACCOUNT || '1234567890',
  accountHolder: process.env.DEFAULT_BANK_HOLDER || 'WORTHTOBUY',
  footer: 'Thank you for shopping with WORTHTOBUY. Your items are handled with utmost care.',
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) { }

  async getAll() {
    const [data, brandRecord, invoiceRecord] = await Promise.all([
      this.prisma.setting.findMany(),
      this.prisma.brand_setting.findFirst({ orderBy: { id: 'desc' } }),
      this.prisma.invoice_setting.findFirst({ orderBy: { id: 'desc' } }),
    ]);

    const map = Object.fromEntries(data.map(x => [x.key, x.value]));

    const brandData = brandRecord
      ? {
          name: brandRecord.name,
          tagline: brandRecord.tagline || '',
          whatsapp: brandRecord.whatsapp,
          instagram: brandRecord.instagram,
          instagramUrl: brandRecord.instagram_url,
          primaryColor: brandRecord.primary_color || '#b7332b',
          logoUrl: brandRecord.logo_url || '/worthtobuy-logo.png',
        }
      : {
          ...DEFAULT_BRAND_CONFIG,
          ...((map['brand'] as Record<string, any>) || {}),
        };

    const invoiceData = invoiceRecord
      ? {
          prefix: invoiceRecord.prefix,
          businessName: invoiceRecord.business_name,
          whatsapp: invoiceRecord.whatsapp || '',
          email: invoiceRecord.email || '',
          address: invoiceRecord.address || '',
          bankName: invoiceRecord.bank_name,
          accountNumber: invoiceRecord.account_number,
          accountHolder: invoiceRecord.account_holder,
          footer: invoiceRecord.footer || '',
        }
      : {
          ...DEFAULT_INVOICE_CONFIG,
          ...((map['invoice'] as Record<string, any>) || {}),
        };

    return {
      ...map,
      brand: brandData,
      invoice: invoiceData,
    };
  }

  async updateKey(key: string, value: any) {
    if (key === 'brand' && value && typeof value === 'object') {
      const existing = await this.prisma.brand_setting.findFirst();
      const payload = {
        name: value.name !== undefined ? String(value.name) : '',
        tagline: value.tagline !== undefined ? String(value.tagline) : '',
        whatsapp: value.whatsapp !== undefined ? String(value.whatsapp) : '',
        instagram: value.instagram !== undefined ? String(value.instagram) : '',
        instagram_url:
          value.instagramUrl !== undefined
            ? String(value.instagramUrl)
            : value.instagram_url !== undefined
            ? String(value.instagram_url)
            : '',
        primary_color: value.primaryColor || value.primary_color || '#b7332b',
        logo_url:
          value.logoUrl !== undefined
            ? String(value.logoUrl)
            : value.logo_url !== undefined
            ? String(value.logo_url)
            : '',
      };

      if (existing) {
        await this.prisma.brand_setting.update({
          where: { id: existing.id },
          data: payload,
        });
      } else {
        await this.prisma.brand_setting.create({ data: payload });
      }
    }

    if (key === 'invoice' && value && typeof value === 'object') {
      const existing = await this.prisma.invoice_setting.findFirst();
      const payload = {
        prefix: value.prefix !== undefined && String(value.prefix).trim() ? String(value.prefix).trim() : 'WTB-INV',
        business_name:
          value.businessName !== undefined
            ? String(value.businessName)
            : value.business_name !== undefined
            ? String(value.business_name)
            : '',
        whatsapp: value.whatsapp !== undefined ? String(value.whatsapp) : '',
        email: value.email !== undefined ? String(value.email) : '',
        address: value.address !== undefined ? String(value.address) : '',
        bank_name:
          value.bankName !== undefined
            ? String(value.bankName)
            : value.bank_name !== undefined
            ? String(value.bank_name)
            : '',
        account_number:
          value.accountNumber !== undefined
            ? String(value.accountNumber)
            : value.account_number !== undefined
            ? String(value.account_number)
            : '',
        account_holder:
          value.accountHolder !== undefined
            ? String(value.accountHolder)
            : value.account_holder !== undefined
            ? String(value.account_holder)
            : '',
        footer: value.footer !== undefined ? String(value.footer) : '',
      };

      if (existing) {
        await this.prisma.invoice_setting.update({
          where: { id: existing.id },
          data: payload,
        });
      } else {
        await this.prisma.invoice_setting.create({ data: payload });
      }
    }

    // Keep settings key-value updated as well for complete backwards compatibility
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
