import { PrismaService } from '../../../config/prisma/prisma.service';

export async function fetchPublicCatalogProducts(
  prisma: PrismaService,
  query: any
) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 24)));
  const skip = (page - 1) * limit;

  const search = String(query.search || '').trim();
  const category = query.category ? String(query.category) : undefined;
  const brand = query.brand ? String(query.brand) : undefined;
  const stock_mode = query.stock_mode ? String(query.stock_mode) : undefined;
  const period_id = query.period_id ? Number(query.period_id) : undefined;

  const where: any = {
    deleted_at: null,
    is_active: true,
    ...(stock_mode
      ? { stock_mode }
      : { stock_mode: { in: ['READY_STOCK', 'BOTH'] } }),
    ...(category
      ? { category: { equals: category, mode: 'insensitive' } }
      : {}),
    ...(brand
      ? { brand_name: { equals: brand, mode: 'insensitive' } }
      : {}),
    ...(period_id ? { period_id } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { brand_name: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total, categoriesRaw, brandsRaw] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ stock_quantity: 'desc' }, { created_at: 'desc' }],
      include: {
        period: {
          select: {
            id: true,
            name: true,
            city: true,
            country: true,
            status: true,
          },
        },
      },
    }),
    prisma.product.count({ where }),
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
    prisma.product.findMany({
      where: {
        deleted_at: null,
        is_active: true,
        stock_mode: { in: ['READY_STOCK', 'BOTH'] },
        brand_name: { not: null },
      },
      select: { brand_name: true },
      distinct: ['brand_name'],
    }),
  ]);

  const categories = categoriesRaw.map((c) => c.category).filter(Boolean);
  const brands = brandsRaw.map((b) => b.brand_name).filter(Boolean);

  const normalizedItems = items.map((p) => {
    const rawImgs = p.image_urls || [];
    const primaryImg =
      p.image_url ||
      (Array.isArray(rawImgs) && rawImgs.length > 0 ? rawImgs[0] : null);
    return {
      ...p,
      imageUrl: primaryImg,
      imageUrls: rawImgs,
      brandName: p.brand_name,
      sellingPrice: Number(p.selling_price),
      buyPrice: Number(p.buy_price),
      stockQuantity: p.stock_quantity,
      stockMode: p.stock_mode,
    };
  });

  return {
    items: normalizedItems,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    filters: {
      categories,
      brands,
    },
  };
}

export async function fetchPublicCatalogProductDetail(
  prisma: PrismaService,
  id: number
) {
  const p = await prisma.product.findFirstOrThrow({
    where: {
      id,
      deleted_at: null,
      is_active: true,
    },
    include: {
      period: {
        select: {
          id: true,
          name: true,
          city: true,
          country: true,
          status: true,
        },
      },
    },
  });

  const rawImgs = p.image_urls || [];
  const primaryImg =
    p.image_url ||
    (Array.isArray(rawImgs) && rawImgs.length > 0 ? rawImgs[0] : null);

  return {
    ...p,
    imageUrl: primaryImg,
    imageUrls: rawImgs,
    brandName: p.brand_name,
    sellingPrice: Number(p.selling_price),
    buyPrice: Number(p.buy_price),
    stockQuantity: p.stock_quantity,
    stockMode: p.stock_mode,
  };
}
