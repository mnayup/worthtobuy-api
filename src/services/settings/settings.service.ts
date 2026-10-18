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

export const DEFAULT_WHATSAPP_TEMPLATES: Record<string, string> = {
  BILLING:
    `📚🌱 *INVOICE WORTHTOBUY*\n\n` +
    `Halo kak {{customerName}},\n` +
    `Terima kasih sudah memesan di WORTHTOBUY! Pesanan ({{eventLabel}}) sudah kami catat.\n\n` +
    `No. Invoice: {{invoiceNumber}}\n` +
    `Total tagihan: *{{totalBill}}*{{depositLine}}\n` +
    `*Sisa yang harus dibayar:* *{{outstandingAmount}}*\n` +
    `Jatuh tempo: {{dueDate}}\n\n` +
    `💳 Pembayaran transfer bank.\n` +
    `Setelah transfer, silakan upload bukti pembayaran lewat link di bawah ya kak.{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
  DP:
    `📚🌱 *INVOICE WORTHTOBUY* (DP)\n\n` +
    `Halo kak {{customerName}},\n` +
    `Terima kasih sudah memesan di WORTHTOBUY! Pesanan ({{eventLabel}}) sudah kami catat.\n\n` +
    `No. Invoice: {{invoiceNumber}}\n` +
    `Total pesanan: {{totalBill}}{{depositLine}}\n` +
    `*Dibayar sekarang (DP): {{dpAmount}}* ({{dpPercent}}%)\n` +
    `Sisa {{remainingAfterDp}} dilunasi {{settlementNote}}.\n\n` +
    `💳 Pembayaran transfer bank.\n` +
    `Setelah transfer DP, mohon kirimkan buktinya via link di bawah ini ya kak.{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
  SETTLEMENT:
    `📚🌱 *PELUNASAN — WORTHTOBUY*\n\n` +
    `Halo kak {{customerName}},\n` +
    `Kabar baik! Pesanan kakak ({{eventLabel}}) sudah siap, tinggal pelunasan ya.\n\n` +
    `No. Invoice: {{invoiceNumber}}\n` +
    `Total pesanan: {{totalBill}}{{depositLine}}\n` +
    `Sudah dibayar (DP): {{paidAmount}}\n` +
    `*Sisa yang perlu dilunasi: {{outstandingAmount}}*\n\n` +
    `💳 Pembayaran transfer bank.\n` +
    `Setelah transfer, silakan upload bukti pelunasannya ya kak.{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
  FULL_PAYMENT:
    `📚🌱 *INVOICE LUNAS — WORTHTOBUY*\n\n` +
    `Halo kak {{customerName}},\n` +
    `Pembayaran invoice *{{invoiceNumber}}* sebesar *{{totalBill}}*{{depositLine}} telah kami terima dan dinyatakan *LUNAS*.\n\n` +
    `Terima kasih banyak sudah mempercayakan pesanan kakak di WORTHTOBUY! 🙏{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
  OVERDUE:
    `📚🌱 *INVOICE WORTHTOBUY* (PENGINGAT)\n\n` +
    `Halo kak {{customerName}},\n` +
    `Mengingatkan untuk invoice *{{invoiceNumber}}* ({{eventLabel}}).\n\n` +
    `Total Bill: {{totalBill}}\n` +
    `Remaining: {{outstandingAmount}}{{depositLine}}\n\n` +
    `Invoice melewati jatuh tempo ({{dueDate}}).{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
  PAYMENT_CONFIRMATION:
    `📚🌱 *KONFIRMASI PEMBAYARAN — WORTHTOBUY*\n\n` +
    `Halo kak {{customerName}},\n` +
    `Mengenai pesanan invoice *{{invoiceNumber}}* ({{eventLabel}}):\n\n` +
    `Pembayaran *{{paidAmount}}* diverifikasi.{{depositLine}} Sisa: *{{outstandingAmount}}*.{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
  UNAVAILABLE_ITEM:
    `📚🌱 *PEMBERITAHUAN BARANG KOSONG — WORTHTOBUY*\n\n` +
    `Halo kak {{customerName}},\n` +
    `Mengenai pesanan pada invoice *{{invoiceNumber}}* ({{eventLabel}}):\n\n` +
    `Item berikut tidak tersedia di event:{{itemLines}}\n\n` +
    `Hubungi admin untuk opsi refund atau pengganti.{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
  READY_TO_SHIP:
    `📚🌱 *PESANAN SIAP KIRIM — WORTHTOBUY*\n\n` +
    `Halo kak {{customerName}},\n` +
    `Mengenai pesanan pada invoice *{{invoiceNumber}}* ({{eventLabel}}):\n\n` +
    `Pesanan selesai dipacking dan siap dikirim:{{itemLines}}{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
  TRACKING:
    `📚🌱 *INFO PENGIRIMAN & RESI — WORTHTOBUY*\n\n` +
    `Halo kak {{customerName}},\n` +
    `Mengenai pesanan pada invoice *{{invoiceNumber}}* ({{eventLabel}}):\n\n` +
    `Pesanan diserahkan ke kurir{{shipmentInfo}}.{{linkSection}}\n\n` +
    `Salam hangat,\n` +
    `Tim WORTHTOBUY`,
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
          qrisImageUrl: invoiceRecord.qris_image_url || '',
        }
      : {
          ...DEFAULT_INVOICE_CONFIG,
          ...((map['invoice'] as Record<string, any>) || {}),
          qrisImageUrl:
            ((map['invoice'] as Record<string, any>)?.qrisImageUrl) ||
            ((map['invoice'] as Record<string, any>)?.qris_image_url) ||
            '',
        };

    const whatsappTemplatesData = {
      ...DEFAULT_WHATSAPP_TEMPLATES,
      ...((map['whatsapp_templates'] as Record<string, string>) || {}),
    };

    return {
      ...map,
      brand: brandData,
      invoice: invoiceData,
      whatsapp_templates: whatsappTemplatesData,
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
        qris_image_url:
          value.qrisImageUrl !== undefined
            ? String(value.qrisImageUrl)
            : value.qris_image_url !== undefined
            ? String(value.qris_image_url)
            : '',
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
