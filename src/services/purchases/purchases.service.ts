import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { RefundService } from '../shared/refund.service';
import { StockService } from '../shared/stock.service';
import { sequence } from '../../common/utils/http.utils';
import {
  handlePurchasedTransitionHelper,
  handleUnavailableTransitionHelper,
} from './helpers/purchase-transitions.helper';
import {
  embedSortingIntoNotes,
  extractSortingFromNotes,
  formatConsolidatedPurchase,
  groupPurchasesByNumber,
} from './helpers/purchase-consolidation.helper';
import {
  cleanPurchaseData,
  syncNewProductSpecsHelper,
  updateConsolidatedPurchaseHelper,
} from './helpers/purchase-update.helper';

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private refundService: RefundService,
    private stockService: StockService,
  ) {}

  async findAll(query: any) {
    const search = String(query.search || '').trim().slice(0, 100);
    const status = query.status ? String(query.status) : undefined;
    const periodId = query.periodId || query.period_id;
    const brand = query.brand || query.brandName || query.brand_name;
    const productId = query.productId || query.product_id;

    const andConditions: any[] = [
      {
        OR: [
          { order_item_id: null },
          { order_item: { order: { deleted_at: null } } },
        ],
      },
    ];
    if (status) andConditions.push({ status });
    if (periodId) andConditions.push({ period_id: Number(periodId) });
    if (productId) {
      andConditions.push({
        OR: [
          { product_id: Number(productId) },
          { order_item: { product_id: Number(productId) } },
        ],
      });
    }
    if (brand) {
      andConditions.push({
        OR: [
          { brand_name: { equals: String(brand).trim(), mode: 'insensitive' } },
          { product: { brand_name: { equals: String(brand).trim(), mode: 'insensitive' } } },
        ],
      });
    }
    if (search) {
      andConditions.push({
        OR: [
          { purchase_number: { contains: search, mode: 'insensitive' } },
          { brand_name: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
          { product: { sku: { contains: search, mode: 'insensitive' } } },
          { shopper: { name: { contains: search, mode: 'insensitive' } } },
          { period: { code: { contains: search, mode: 'insensitive' } } },
          { period: { name: { contains: search, mode: 'insensitive' } } },
          { payment_method: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
          {
            order_item: {
              manual_product_name: { contains: search, mode: 'insensitive' },
            },
          },
          {
            order_item: {
              order: { order_number: { contains: search, mode: 'insensitive' } },
            },
          },
          {
            order_item: {
              order: {
                customer: { full_name: { contains: search, mode: 'insensitive' } },
              },
            },
          },
        ],
      });
    }

    const where: any = { AND: andConditions };

    const rawPurchases = await this.prisma.purchase.findMany({
      where,
      orderBy: [{ purchase_date: 'desc' }, { id: 'desc' }],
      include: {
        product: true,
        period: true,
        shopper: { select: { name: true } },
        order_item: {
          include: {
            product: true,
            order: {
              include: {
                customer: true,
                invoice_links: { include: { invoice: true } },
              },
            },
          },
        },
      },
    });

    const consolidated = groupPurchasesByNumber(rawPurchases);
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const paginated = consolidated.slice(skip, skip + limit);

    return {
      data: paginated,
      total: consolidated.length,
      page,
      limit,
    };
  }

  async findOne(id: number) {
    const target = await this.prisma.purchase.findUniqueOrThrow({ where: { id } });
    const where: any = target.purchase_number
      ? { purchase_number: target.purchase_number }
      : target.status === 'WAITING_PURCHASE' && target.period_id
        ? { period_id: target.period_id, status: 'WAITING_PURCHASE' }
        : { id: target.id };

    const allRows = await this.prisma.purchase.findMany({
      where,
      include: {
        product: true,
        period: true,
        shopper: { select: { name: true } },
        order_item: {
          include: {
            product: true,
            order: {
              include: {
                customer: true,
                invoice_links: { include: { invoice: true } },
              },
            },
          },
        },
      },
    });
    return formatConsolidatedPurchase(allRows);
  }

  async getSummary() {
    const raw = await this.prisma.purchase.findMany({
      where: {
        OR: [
          { order_item_id: null },
          { order_item: { order: { deleted_at: null } } },
        ],
      },
      select: { purchase_number: true, status: true, period_id: true },
    });
    const map = new Map<string, string[]>();
    raw.forEach((r) => {
      const key =
        r.purchase_number ||
        (r.period_id ? `EVENT_${r.period_id}_WAITING` : 'UNKNOWN');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r.status);
    });

    const summary = {
      TOTAL: map.size,
      WAITING_PURCHASE: 0,
      SORTING: 0,
      PURCHASED: 0,
      UNAVAILABLE: 0,
    };

    for (const statuses of map.values()) {
      if (statuses.every((s) => s === 'PURCHASED')) summary.PURCHASED++;
      else if (statuses.every((s) => s === 'UNAVAILABLE')) summary.UNAVAILABLE++;
      else if (statuses.some((s) => s === 'SORTING')) summary.SORTING++;
      else summary.WAITING_PURCHASE++;
    }

    return summary;
  }

  async create(body: any, userId?: number) {
    const oItemId = body.order_item_id ?? body.orderItemId;
    const cleaned = cleanPurchaseData(body);

    // Manual purchase flow (no order_item_id) — only for LIVE_SHOPPING events
    if (!oItemId) {
      const periodId = cleaned.period_id || Number(body.period_id || body.periodId || 0);
      if (!periodId) {
        throw new BadRequestException('Please select a Live Shopping event.');
      }
      const period = await this.prisma.jastip_period.findUnique({
        where: { id: Number(periodId) },
      });
      if (!period || period.type !== 'LIVE_SHOPPING') {
        throw new BadRequestException(
          'Manual purchase without an ordered item is only allowed for Live Shopping events.'
        );
      }

      const parseTagList = (raw: any): string[] => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
        return String(raw)
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
      };

      const rawVariantItems = Array.isArray(body.variantItems) && body.variantItems.length > 0
        ? body.variantItems
        : [
            {
              variant: '',
              size: '',
              quantity: Math.max(1, Number(cleaned.quantity || body.quantity || 1)),
              buyPrice: Number(body.newProductBuyPrice ?? 0),
              sellingPrice: Number(body.newProductSellingPrice ?? 0),
            },
          ];

      const normalizedItems = rawVariantItems.map((it: any) => ({
        variant: String(it.variant || '').trim(),
        size: String(it.size || '').trim(),
        quantity: Math.max(1, Number(it.quantity || 1)),
        buyPrice: Math.max(0, Number(it.buyPrice || 0)),
        sellingPrice: Math.max(0, Number(it.sellingPrice ?? 0)),
      }));

      // Group rows with the same (buyPrice, sellingPrice) into 1 rule; split different prices into separate rules
      const buildGroupedRules = (
        rows: Array<{ variant: string; size: string; buyPrice: number; sellingPrice: number }>,
        existingRules: any[] = [],
        fallbackSellingPrice = 0
      ) => {
        const ruleMap = new Map<
          string,
          { variants: Set<string>; sizes: Set<string>; buyPrice: number; sellingPrice: number }
        >();

        // Lookup existing selling price for a (variant, size) so updating buyPrice (modal) never overwrites sellingPrice with buyPrice
        const findExistingSellPrice = (v: string, s: string): number => {
          const nv = v.trim().toLowerCase();
          const ns = s.trim().toLowerCase();
          for (const r of existingRules) {
            const rVars = (Array.isArray(r.variants) ? r.variants : []).map((x: any) => String(x).trim().toLowerCase());
            const rSizes = (Array.isArray(r.sizes) ? r.sizes : []).map((x: any) => String(x).trim().toLowerCase());
            const vMatch = rVars.length === 0 || (nv && rVars.includes(nv));
            const sMatch = rSizes.length === 0 || (ns && rSizes.includes(ns));
            if (vMatch && sMatch && Number(r.sellingPrice || 0) > 0) {
              return Number(r.sellingPrice);
            }
          }
          return fallbackSellingPrice;
        };

        // Seed from existing rules if updating an existing product
        for (const r of existingRules) {
          const bp = Math.max(0, Number(r.buyPrice ?? 0));
          const sp = Math.max(0, Number(r.sellingPrice ?? 0));
          if (bp <= 0 && sp <= 0) continue;
          const key = `${bp}___${sp}`;
          if (!ruleMap.has(key)) {
            ruleMap.set(key, {
              variants: new Set<string>(),
              sizes: new Set<string>(),
              buyPrice: bp,
              sellingPrice: sp,
            });
          }
          const grp = ruleMap.get(key)!;
          (Array.isArray(r.variants) ? r.variants : []).forEach((v: any) => {
            if (v && String(v).trim()) grp.variants.add(String(v).trim());
          });
          (Array.isArray(r.sizes) ? r.sizes : []).forEach((s: any) => {
            if (s && String(s).trim()) grp.sizes.add(String(s).trim());
          });
        }

        // Add/merge current purchase items
        for (const row of rows) {
          const bp = Math.max(0, Number(row.buyPrice || 0));
          const sp =
            Number(row.sellingPrice || 0) > 0
              ? Math.max(0, Number(row.sellingPrice))
              : findExistingSellPrice(row.variant, row.size);
          if (bp <= 0 && sp <= 0) continue;
          const key = `${bp}___${sp}`;
          if (!ruleMap.has(key)) {
            ruleMap.set(key, {
              variants: new Set<string>(),
              sizes: new Set<string>(),
              buyPrice: bp,
              sellingPrice: sp,
            });
          }
          const grp = ruleMap.get(key)!;
          if (row.variant) grp.variants.add(row.variant);
          if (row.size) grp.sizes.add(row.size);
        }

        return Array.from(ruleMap.values()).map((g) => ({
          variants: Array.from(g.variants),
          sizes: Array.from(g.sizes),
          buyPrice: g.buyPrice,
          sellingPrice: g.sellingPrice,
        }));
      };

      const rawImgs = body.newProductImageUrls;
      const imgs: string[] = Array.isArray(rawImgs) ? rawImgs.filter(Boolean) : [];

      let productId =
        cleaned.product_id ||
        (body.productId && body.productId !== '__NEW_PRODUCT__' ? Number(body.productId) : null);

      if (!productId && (body.productId === '__NEW_PRODUCT__' || body.newProductName)) {
        const newName = String(body.newProductName || '').trim();
        if (!newName) {
          throw new BadRequestException('Please enter a name for the new product.');
        }

        const allVariants = Array.from(
          new Set([
            ...parseTagList(body.newProductVariant),
            ...normalizedItems.map((i) => i.variant).filter(Boolean),
          ])
        );
        const allSizes = Array.from(
          new Set([
            ...parseTagList(body.newProductSize),
            ...normalizedItems.map((i) => i.size).filter(Boolean),
          ])
        );

        const variantRules = buildGroupedRules(
          normalizedItems,
          [],
          Number(body.newProductSellingPrice ?? 0)
        );
        const baseBuyPrice =
          normalizedItems[0]?.buyPrice ?? Number(body.newProductBuyPrice ?? 0);
        const baseSellingPrice =
          normalizedItems.find((i) => i.sellingPrice > 0)?.sellingPrice ??
          Number(body.newProductSellingPrice ?? 0);

        const createdProd = await this.prisma.product.create({
          data: {
            sku: sequence('SKU'),
            name: newName,
            brand_name: body.newProductBrand ? String(body.newProductBrand).trim() : null,
            category: body.newProductCategory ? String(body.newProductCategory).trim() : null,
            variant: allVariants.length > 0 ? allVariants.join(', ') : null,
            size: allSizes.length > 0 ? allSizes.join(', ') : null,
            buy_price: baseBuyPrice,
            selling_price: baseSellingPrice,
            variant_prices: {
              variantRules,
              bundleRules: [],
            } as any,
            image_url: imgs[0] || null,
            image_urls: imgs,
            stock_mode: 'EVENT',
            stock_quantity: 0,
            period_id: period.id,
          },
        });
        productId = createdProd.id;
      }

      if (!productId) {
        throw new BadRequestException('Please select a product for this Live Shopping purchase.');
      }

      let product = await this.prisma.product.findUniqueOrThrow({
        where: { id: Number(productId) },
      });

      // If selecting an existing product, merge new variants, sizes, optional images, and grouped variantRules into that 1 product
      if (body.productId !== '__NEW_PRODUCT__') {
        const mergedVariants = Array.from(
          new Set([
            ...parseTagList(product.variant),
            ...parseTagList(body.newProductVariant),
            ...normalizedItems.map((i) => i.variant).filter(Boolean),
          ])
        );
        const mergedSizes = Array.from(
          new Set([
            ...parseTagList(product.size),
            ...parseTagList(body.newProductSize),
            ...normalizedItems.map((i) => i.size).filter(Boolean),
          ])
        );

        const existingVp: any =
          product.variant_prices && typeof product.variant_prices === 'object'
            ? product.variant_prices
            : {};
        const existingVariantRules = Array.isArray(existingVp)
          ? existingVp
          : Array.isArray(existingVp.variantRules)
            ? existingVp.variantRules
            : [];
        const existingBundleRules = Array.isArray(existingVp.bundleRules)
          ? existingVp.bundleRules
          : [];

        const mergedVariantRules = buildGroupedRules(
          normalizedItems,
          existingVariantRules,
          Number(product.selling_price || 0)
        );

        const nextBuyPrice =
          normalizedItems[0]?.buyPrice > 0
            ? normalizedItems[0].buyPrice
            : Number(product.buy_price || 0);
        const nextSellingPrice =
          Number(product.selling_price || 0) > 0
            ? Number(product.selling_price)
            : normalizedItems.find((i) => i.sellingPrice > 0)?.sellingPrice || 0;

        product = await this.prisma.product.update({
          where: { id: product.id },
          data: {
            variant: mergedVariants.length > 0 ? mergedVariants.join(', ') : product.variant,
            size: mergedSizes.length > 0 ? mergedSizes.join(', ') : product.size,
            buy_price: nextBuyPrice,
            selling_price: nextSellingPrice,
            variant_prices: {
              variantRules: mergedVariantRules,
              bundleRules: existingBundleRules,
            } as any,
            ...(imgs.length > 0
              ? { image_url: imgs[0], image_urls: imgs }
              : {}),
          },
        });
      }

      const status = cleaned.status || 'PURCHASED';
      const purchaseNumber = cleaned.purchase_number || sequence('PUR');
      const brandName =
        cleaned.brand_name && cleaned.brand_name !== '-'
          ? cleaned.brand_name
          : product.brand_name || '-';

      const createdPurchases: any[] = [];
      let totalPurchasedQty = 0;

      for (const row of normalizedItems) {
        const rowQty = Math.max(1, Number(row.quantity || 1));
        const unitCost =
          row.buyPrice > 0 ? row.buyPrice : Number(product.buy_price || 0);
        const rowCost = unitCost * rowQty;

        const createdRow = await this.prisma.purchase.create({
          data: {
            ...cleaned,
            order_item_id: null,
            period_id: period.id,
            product_id: product.id,
            brand_name: brandName,
            variation: row.variant || null,
            size: row.size || null,
            quantity: rowQty,
            status,
            purchase_number: purchaseNumber,
            shopper_id: cleaned.shopper_id || userId,
            estimated_price: rowCost,
            actual_price: rowCost,
            price_difference: 0,
            currency_code: 'IDR',
            exchange_rate: 1,
          },
          include: {
            product: true,
            period: true,
          },
        });
        createdPurchases.push(createdRow);
        totalPurchasedQty += rowQty;
      }

      if (status === 'PURCHASED' && totalPurchasedQty > 0) {
        await this.stockService.addStockFromPurchase(
          this.prisma,
          product.id,
          totalPurchasedQty,
          userId,
          String(createdPurchases[0].id),
          `Stok masuk (${totalPurchasedQty} pcs) dari pembelian Live Shopping (${period.name}).`
        );
      }

      return createdPurchases[0];
    }

    const item = await this.prisma.order_item.findUniqueOrThrow({
      where: { id: Number(oItemId) },
      include: {
        product: true,
        order: { include: { customer: true } },
      },
    });
    const status = cleaned.status || 'WAITING_PURCHASE';
    const buyPrice = Number(item.product?.buy_price || 0);
    const unitCost = buyPrice > 0
      ? buyPrice
      : Number(item.target_price_idr ?? item.unit_price_foreign ?? 0);
    const qty = Number(cleaned.quantity || item.quantity || 1);
    const defaultCost = unitCost * qty;
    const estimated = Number(cleaned.estimated_price ?? defaultCost);
    const actual = Number(cleaned.actual_price ?? estimated);

    const data = await this.prisma.purchase.create({
      data: {
        ...cleaned,
        order_item_id: item.id,
        period_id: cleaned.period_id || item.order.period_id,
        brand_name: cleaned.brand_name || item.brand_name || '-',
        quantity: cleaned.quantity || item.quantity || 1,
        status,
        product_id: cleaned.product_id !== undefined ? cleaned.product_id : item.product_id || null,
        purchase_number: cleaned.purchase_number || sequence('PUR'),
        shopper_id: cleaned.shopper_id || userId,
        estimated_price: estimated,
        actual_price: actual,
        price_difference: actual - estimated,
        currency_code: 'IDR',
        exchange_rate: 1,
      },
      include: {
        order_item: { include: { order: { include: { customer: true } } } },
      },
    });

    if (status === 'PURCHASED' && data.order_item) {
      await handlePurchasedTransitionHelper(
        this.prisma,
        data.order_item.order,
        item.id,
        item.fulfillment_status,
        userId
      );
    } else if (status === 'UNAVAILABLE' && data.order_item) {
      await handleUnavailableTransitionHelper(
        this.prisma,
        this.refundService,
        data.order_item.order,
        item.id,
        item.fulfillment_status,
        userId
      );
    }

    return data;
  }

  async update(id: number, body: any, userId?: number) {
    const current = await this.prisma.purchase.findUniqueOrThrow({
      where: { id },
      include: {
        period: true,
        order_item: {
          include: { order: { include: { customer: true } } },
        },
      },
    });

    // Check if updating via consolidated items checklist
    if (Array.isArray(body.items) && body.items.length > 0) {
      const targetId = await updateConsolidatedPurchaseHelper(
        this.prisma,
        this.refundService,
        current.purchase_number,
        body,
        userId,
        this.stockService
      );
      return this.findOne(targetId || current.id);
    }

    const cleaned = cleanPurchaseData(body);
    const estimated = Number(cleaned.estimated_price ?? current.estimated_price);
    const actual = Number(cleaned.actual_price ?? current.actual_price);
    const price_difference = actual - estimated;
    const nextQty = Number(cleaned.quantity ?? current.quantity);
    const targetStatus = cleaned.status || current.status;

    if (Array.isArray(body.newProductSpecs) && body.newProductSpecs.length > 0) {
      await syncNewProductSpecsHelper(this.prisma, body.newProductSpecs);
    }

    const existingExtracted = extractSortingFromNotes(current.notes);
    const nextCleanNotes =
      cleaned.notes !== undefined ? cleaned.notes : existingExtracted.cleanNotes;
    const nextSortingLines = Array.isArray(body.sortingLines)
      ? body.sortingLines
      : existingExtracted.sortingLines;
    const mergedNotes = embedSortingIntoNotes(nextCleanNotes, nextSortingLines);
    if (cleaned.notes !== undefined || Array.isArray(body.sortingLines)) {
      cleaned.notes = mergedNotes;
    }

    // If updating a consolidated purchase batch (e.g. status transition to SORTING or updating sortingLines), update all rows sharing the same purchase_number
    if (current.purchase_number && (body.status || Array.isArray(body.sortingLines))) {
      await this.prisma.purchase.updateMany({
        where: { purchase_number: current.purchase_number },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.shopper_id !== undefined ? { shopper_id: Number(body.shopper_id) || null } : {}),
          ...(body.payment_method !== undefined ? { payment_method: body.payment_method } : {}),
          ...(cleaned.notes !== undefined || Array.isArray(body.sortingLines)
            ? { notes: mergedNotes }
            : {}),
          ...(body.receipt_url !== undefined ? { receipt_url: body.receipt_url } : {}),
        },
      });
    }

    const data = await this.prisma.purchase.update({
      where: { id: current.id },
      data: {
        ...cleaned,
        product_id: cleaned.product_id === undefined ? undefined : cleaned.product_id || null,
        estimated_price: estimated,
        actual_price: actual,
        price_difference,
        currency_code: 'IDR',
        exchange_rate: 1,
      },
      include: {
        order_item: {
          include: { order: { include: { customer: true } } },
        },
      },
    });

    // If manual Live Shopping purchase (no order_item_id), sync stock quantity changes
    if (!current.order_item_id && current.product_id && current.period?.type === 'LIVE_SHOPPING') {
      const oldEffectiveQty = current.status === 'PURCHASED' ? Number(current.quantity || 0) : 0;
      const newEffectiveQty = targetStatus === 'PURCHASED' ? nextQty : 0;
      const delta = newEffectiveQty - oldEffectiveQty;
      if (delta !== 0) {
        await this.stockService.addStockFromPurchase(
          this.prisma,
          current.product_id,
          delta,
          userId,
          String(current.id),
          'Penyesuaian stok dari pembaruan pembelian Live Shopping.'
        );
      }
    } else if (body.status && body.status !== current.status && current.order_item && current.order_item_id) {
      const order = current.order_item.order;
      const order_item_id = current.order_item_id;
      const from_status = current.order_item.fulfillment_status;

      if (body.status === 'PURCHASED') {
        await handlePurchasedTransitionHelper(
          this.prisma,
          order,
          order_item_id,
          from_status,
          userId
        );
      } else if (body.status === 'UNAVAILABLE') {
        await handleUnavailableTransitionHelper(
          this.prisma,
          this.refundService,
          order,
          order_item_id,
          from_status,
          userId
        );
      }
    }

    if (current.purchase_number) {
      return this.findOne(current.id);
    }

    return data;
  }
}
