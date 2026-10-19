import { PrismaService } from '../../../config/prisma/prisma.service';
import { PUBLIC_HIGHLIGHTS } from './public-content.helper';

export async function fetchPublicOverviewData(prisma: PrismaService) {
  const [totalEvents, totalProducts, readyStockCount, openEvents] =
    await Promise.all([
      prisma.jastip_period.count({ where: { deleted_at: null } }),
      prisma.product.count({
        where: { deleted_at: null, is_active: true },
      }),
      prisma.product.count({
        where: {
          deleted_at: null,
          is_active: true,
          stock_mode: { in: ['READY_STOCK', 'BOTH'] },
        },
      }),
      prisma.jastip_period.count({
        where: {
          deleted_at: null,
          status: { in: ['OPEN', 'SHOPPING'] },
        },
      }),
    ]);

  const [categoriesRaw, rawSettings, brandRecord, invoiceRecord] =
    await Promise.all([
      prisma.product.findMany({
        where: {
          deleted_at: null,
          is_active: true,
          stock_mode: { in: ['READY_STOCK', 'BOTH'] },
          category: { not: null },
        },
        select: { category: true },
        distinct: ['category'],
      }),
      prisma.setting.findMany(),
      prisma.brand_setting.findFirst({ orderBy: { id: 'desc' } }),
      prisma.invoice_setting.findFirst({ orderBy: { id: 'desc' } }),
    ]);

  const settingsMap = Object.fromEntries(
    rawSettings.map((x) => [x.key, x.value])
  );
  const fallbackBrandVal = (settingsMap['brand'] as any) || {};
  const fallbackInvoiceVal = (settingsMap['invoice'] as any) || {};

  const brandName =
    brandRecord?.name ||
    fallbackBrandVal.name ||
    process.env.BRAND_NAME ||
    'WORTHTOBUY';

  const brandTagline =
    brandRecord?.tagline ||
    fallbackBrandVal.tagline ||
    process.env.BRAND_TAGLINE ||
    'Your Trusted Jastip Bestie & Personal Shopper Nasional';

  const brandWhatsapp =
    brandRecord?.whatsapp ||
    fallbackBrandVal.whatsapp ||
    invoiceRecord?.whatsapp ||
    fallbackInvoiceVal.whatsapp ||
    process.env.BRAND_WHATSAPP ||
    '6285186852535';

  const brandInstagram =
    brandRecord?.instagram ||
    fallbackBrandVal.instagram ||
    process.env.BRAND_INSTAGRAM ||
    '@worthtobuy_sub';

  const brandInstagramUrl =
    brandRecord?.instagram_url ||
    fallbackBrandVal.instagramUrl ||
    process.env.BRAND_INSTAGRAM_URL ||
    'https://www.instagram.com/worthtobuy_sub';

  const brandPrimaryColor =
    brandRecord?.primary_color ||
    fallbackBrandVal.primaryColor ||
    '#b7332b';

  const brandLogoUrl =
    brandRecord?.logo_url ||
    fallbackBrandVal.logoUrl ||
    '/worthtobuy-logo.png';

  const bankName =
    invoiceRecord?.bank_name ||
    fallbackInvoiceVal.bankName ||
    process.env.DEFAULT_BANK_NAME ||
    'BCA (Bank Central Asia)';

  const bankAccount =
    invoiceRecord?.account_number ||
    fallbackInvoiceVal.accountNumber ||
    process.env.DEFAULT_BANK_ACCOUNT ||
    '1234567890';

  const bankHolder =
    invoiceRecord?.account_holder ||
    fallbackInvoiceVal.accountHolder ||
    process.env.DEFAULT_BANK_HOLDER ||
    'WORTHTOBUY';

  const categories = categoriesRaw.map((c) => c.category).filter(Boolean);

  return {
    brand: {
      name: brandName,
      tagline: brandTagline,
      instagram: brandInstagram,
      instagramUrl: brandInstagramUrl,
      whatsapp: brandWhatsapp,
      city: process.env.BRAND_CITY || 'Indonesia',
      primaryColor: brandPrimaryColor,
      logoUrl: brandLogoUrl,
      bank: {
        bankName,
        accountNumber: bankAccount,
        accountHolder: bankHolder,
      },
      establishedYear: 2019,
      stats: {
        followers: '3,200+',
        eventsCompleted: Math.max(150, totalEvents + 145),
        totalProductsAvailable: totalProducts,
        readyStockItems: readyStockCount,
        activeEvents: openEvents,
        rating: '4.9/5.0',
      },
    },
    categories,
    highlights: PUBLIC_HIGHLIGHTS,
  };
}
