import { PrismaService } from '../../../config/prisma/prisma.service';
import { sequence } from '../../../common/utils/http.utils';
import { isOrderFullyPaid } from '../../shipments/helpers/shipment-sync.helper';

export async function ensurePurchasesForOrderHelper(prisma: PrismaService, order_id: number) {
  const order = await prisma.order.findUnique({
    where: { id: order_id },
    include: {
      period: true,
      items: {
        include: {
          product: true,
          purchases: true,
        },
      },
    },
  });
  if (!order || !order.items || order.items.length === 0) return;

  const isReadyStockPeriod = order.period?.code === 'READY-STOCK';

  for (const item of order.items) {
    // Items fulfilled from product stock (or Ready Stock period) do NOT get inserted into purchases again
    if (
      isReadyStockPeriod ||
      item.source_type === 'READY_STOCK' ||
      item.purchase_status === 'PURCHASED' ||
      item.product?.stock_mode === 'READY_STOCK'
    ) {
      if (item.fulfillment_status === 'PENDING') {
        await prisma.order_item.update({
          where: { id: item.id },
          data: {
            fulfillment_status: 'AVAILABLE',
            purchase_status: 'PURCHASED',
            status_updated_at: new Date(),
          },
        });
      }
      continue;
    }

    if (item.purchases && item.purchases.length > 0) continue;

    const brand = item.brand_name || item.product?.brand_name || '-';
    let buyPrice = Number(item.product?.buy_price || 0);
    const vpRaw: any = item.product?.variant_prices;
    const vRules: any[] = Array.isArray(vpRaw)
      ? vpRaw
      : Array.isArray(vpRaw?.variantRules)
        ? vpRaw.variantRules
        : [];
    if (vRules.length > 0) {
      const iv = String(item.variation || '').trim().toLowerCase();
      const isz = String(item.size || '').trim().toLowerCase();
      for (const r of vRules) {
        const rVars = (Array.isArray(r.variants) ? r.variants : []).map((x: any) => String(x).trim().toLowerCase());
        const rSizes = (Array.isArray(r.sizes) ? r.sizes : []).map((x: any) => String(x).trim().toLowerCase());
        const vMatch = rVars.length === 0 || (iv && rVars.includes(iv));
        const sMatch = rSizes.length === 0 || (isz && rSizes.includes(isz));
        if (vMatch && sMatch && Number(r.buyPrice || 0) > 0) {
          buyPrice = Number(r.buyPrice);
          break;
        }
      }
    }
    const unitCost = buyPrice > 0
      ? buyPrice
      : Number(item.target_price_idr || item.unit_price_foreign || 0);
    const estimated = unitCost * Number(item.quantity || 1);

    // Grouping: If same event has an active WAITING_PURCHASE, consolidate into that same purchase number
    let purchaseNumber: string | null = null;
    let batchNumber = 1;

    if (order.period_id) {
      const eventWaitingPurchase = await prisma.purchase.findFirst({
        where: {
          period_id: order.period_id,
          status: 'WAITING_PURCHASE',
        },
        orderBy: { id: 'asc' },
      });

      if (eventWaitingPurchase) {
        purchaseNumber = eventWaitingPurchase.purchase_number;
        batchNumber = eventWaitingPurchase.batch_number || 1;
      }
    }

    if (!purchaseNumber) {
      const orderExisting = await prisma.purchase.findFirst({
        where: { order_item: { order_id: order.id } },
        orderBy: { id: 'asc' },
      });

      if (orderExisting) {
        purchaseNumber = orderExisting.purchase_number;
        batchNumber = orderExisting.batch_number || 1;
      }
    }

    if (!purchaseNumber && order.period_id) {
      const latestEventPurchase = await prisma.purchase.findFirst({
        where: { period_id: order.period_id },
        orderBy: [{ batch_number: 'desc' }, { id: 'desc' }],
      });
      if (latestEventPurchase) {
        batchNumber = (latestEventPurchase.batch_number || 1) + 1;
        const baseNum = latestEventPurchase.purchase_number.replace(/-B\d+$/, '');
        purchaseNumber = `${baseNum}-B${batchNumber}`;
      }
    }

    if (!purchaseNumber) {
      purchaseNumber = sequence('PUR');
      batchNumber = 1;
    }

    await prisma.purchase.create({
      data: {
        purchase_number: purchaseNumber,
        batch_number: batchNumber,
        purchase_date: new Date(),
        period_id: order.period_id,
        order_item_id: item.id,
        product_id: item.product_id || null,
        brand_name: brand,
        quantity: item.quantity,
        estimated_price: estimated,
        actual_price: estimated,
        price_difference: 0,
        status: 'WAITING_PURCHASE',
        currency_code: 'IDR',
        exchange_rate: 1,
        shopper_id: order.admin_id || null,
      },
    });

    if (item.purchase_status === 'PENDING') {
      await prisma.order_item.update({
        where: { id: item.id },
        data: { purchase_status: 'WAITING_PURCHASE' as any },
      });
    }
  }
}

export async function ensureShipmentForOrderHelper(prisma: PrismaService, order_id: number) {
  const order = await prisma.order.findUnique({
    where: { id: order_id },
    include: {
      customer: true,
      period: true,
      shipments: true,
      shipment_orders: {
        include: {
          shipment: true,
        },
      },
      payments: {
        where: {
          deleted_at: null,
          status: { in: ['VERIFIED', 'PENDING'] },
        },
      },
      invoice_links: {
        include: {
          invoice: {
            include: {
              orders: {
                include: {
                  order: {
                    include: {
                      items: true,
                    },
                  },
                },
              },
              payments: {
                where: {
                  deleted_at: null,
                  status: { in: ['VERIFIED', 'PENDING'] },
                },
              },
            },
          },
        },
      },
      items: {
        include: {
          product: true,
        },
      },
    },
  });
  if (!order || order.status === 'CANCELLED') return;

  const activeItems = (order.items || []).filter(
    (i) => i.fulfillment_status !== 'UNAVAILABLE'
  );
  if (activeItems.length === 0) return;

  const allKept =
    activeItems.length > 0 &&
    activeItems.every((i) => i.fulfillment_status === 'KEPT' || Boolean(i.kept_until));
  if (allKept) return;

  const activeInvoiceLink = (order.invoice_links || []).find(
    (l) => l.invoice && !l.invoice.deleted_at && l.invoice.status !== 'CANCELLED'
  );
  const linkedInvoice: any = activeInvoiceLink?.invoice;

  const isOrderUnavailable = (ord: any) =>
    !ord ||
    ord.status === 'UNAVAILABLE' ||
    (Array.isArray(ord.items) &&
      ord.items.length > 0 &&
      ord.items.every((it: any) => it.fulfillment_status === 'UNAVAILABLE'));

  let isVerifiedFullPaid = false;
  let isUploadedFullPaid = false;

  if (linkedInvoice) {
    const invTotalBill =
      Array.isArray(linkedInvoice.orders) && linkedInvoice.orders.length > 0
        ? linkedInvoice.orders.reduce((sum: number, link: any) => {
            if (isOrderUnavailable(link.order)) return sum;
            return sum + Number(link.order?.total_bill ?? link.snapshot_amount ?? 0);
          }, 0)
        : Number(linkedInvoice.total_bill || 0);
    const invVerifiedPaid =
      Number(linkedInvoice.paid_amount || 0) + Number(linkedInvoice.deposit_amount || 0);
    const invPendingPaid = (linkedInvoice.payments || [])
      .filter((p: any) => p.status === 'PENDING')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

    isVerifiedFullPaid =
      ['PAID', 'OVERPAID', 'REFUND_DUE'].includes(linkedInvoice.status) &&
      Number(linkedInvoice.outstanding_amount || 0) <= 0 &&
      (invTotalBill <= 0 || invVerifiedPaid >= invTotalBill);
    isUploadedFullPaid =
      !isVerifiedFullPaid &&
      invTotalBill > 0 &&
      invVerifiedPaid + invPendingPaid >= invTotalBill;
  } else {
    const ordTotalBill = Number(order.total_bill || 0);
    const ordVerifiedPaid = Number(order.paid_amount || 0);
    const ordPendingPaid = (order.payments || [])
      .filter((p: any) => p.status === 'PENDING')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

    isVerifiedFullPaid =
      Number(order.outstanding_amount || 0) <= 0 &&
      (ordTotalBill <= 0 || ordVerifiedPaid >= ordTotalBill);
    isUploadedFullPaid =
      !isVerifiedFullPaid &&
      ordTotalBill > 0 &&
      ordVerifiedPaid + ordPendingPaid >= ordTotalBill;
  }

  const siblingOrderIds = (order.invoice_links || [])
    .flatMap((link) => link.invoice?.orders.map((o: any) => o.order_id) || [])
    .filter((id) => id !== order.id);

  // Check if sibling orders in the same invoice already have an unpacked shipment
  let candidateShipment: any = null;
  if (siblingOrderIds.length > 0) {
    candidateShipment = await prisma.shipment.findFirst({
      where: {
        status: { in: ['WAITING_VERIFICATION', 'WAITING_PACKING'] as any },
        packed_at: null,
        OR: [
          { order_id: { in: siblingOrderIds } },
          { shipment_orders: { some: { order_id: { in: siblingOrderIds } } } },
        ],
      },
      include: {
        shipment_orders: {
          include: {
            order: {
              include: {
                items: { include: { product: true } },
                invoice_links: { include: { invoice: true } },
              },
            },
          },
        },
      },
    });
  }

  const isLiveOrReadyStock =
    order.period?.type === 'LIVE_SHOPPING' ||
    order.period?.code === 'READY-STOCK' ||
    (activeItems.length > 0 &&
      activeItems.every(
        (i) => i.source_type === 'READY_STOCK' || i.product?.stock_mode === 'READY_STOCK'
      ));
  const isPriorityCustomer = order.customer?.segment === 'PRIORITY';
  const hasPaidDp = Number(order.paid_amount || 0) > 0;

  // Check if order already belongs to any shipment
  const existingShipments = [
    ...(order.shipments || []),
    ...(order.shipment_orders || []).map((so: any) => so.shipment).filter(Boolean),
  ];
  if (existingShipments.length > 0) {
    for (const sh of existingShipments) {
      if (!sh.packed_at && ['WAITING_VERIFICATION', 'WAITING_PACKING'].includes(sh.status)) {
        const desiredStatus = isVerifiedFullPaid ? 'WAITING_PACKING' : 'WAITING_VERIFICATION';
        if (sh.status !== desiredStatus) {
          await prisma.shipment.update({
            where: { id: sh.id },
            data: { status: desiredStatus as any },
          });
        }
      }
    }
    return;
  }

  // Only create/bundle into shipment if:
  // 1) Customer has uploaded or verified Full Payment (isVerifiedFullPaid || isUploadedFullPaid), OR
  // 2) Sibling order in the SAME invoice already has an unpacked shipment (e.g. customer order menyusul added to this invoice), OR
  // 3) Live Shopping / Ready Stock with VIP or DP paid
  const canEnterShipment =
    isVerifiedFullPaid ||
    isUploadedFullPaid ||
    Boolean(candidateShipment) ||
    (isLiveOrReadyStock && (isPriorityCustomer || hasPaidDp));

  if (!canEnterShipment) return;

  const address =
    order.customer?.address && order.customer?.address.trim() !== '-'
      ? order.customer.address.trim()
      : '-';

  const itemsSummary =
    order.items && order.items.length > 0
      ? order.items
          .map(
            (i) =>
              `${i.quantity}x ${i.product?.name || i.manual_product_name || 'Item'}${
                i.variation ? ` (${i.variation})` : ''
              }${i.size ? ` (${i.size})` : ''}${i.color ? ` [${i.color}]` : ''}`
          )
          .join(', ')
      : '';

  const targetInitialStatus = isVerifiedFullPaid ? 'WAITING_PACKING' : 'WAITING_VERIFICATION';

  if (candidateShipment) {
    try {
      // Attach order to candidate shipment of the same invoice
      await prisma.shipment_order.upsert({
        where: {
          shipment_id_order_id: {
            shipment_id: candidateShipment.id,
            order_id: order.id,
          },
        },
        create: {
          shipment_id: candidateShipment.id,
          order_id: order.id,
        },
        update: {},
      });

      const allOrdersInShipment = [
        ...candidateShipment.shipment_orders.map((so: any) => so.order),
        order,
      ];
      const uniqueOrdersMap = new Map();
      for (const ord of allOrdersInShipment) {
        if (ord && !uniqueOrdersMap.has(ord.id)) {
          uniqueOrdersMap.set(ord.id, ord);
        }
      }
      const ordersList = Array.from(uniqueOrdersMap.values());

      const allItems = ordersList.flatMap((o: any) => o.items || []);
      const fullItemsSummary = allItems
        .map(
          (i: any) =>
            `${i.quantity}x ${i.product?.name || i.manual_product_name || 'Item'}${
              i.variation ? ` (${i.variation})` : ''
            }${i.size ? ` (${i.size})` : ''}${i.color ? ` [${i.color}]` : ''}`
        )
        .join(', ');

      const combinedShippingCost = ordersList.reduce(
        (sum: number, o: any) => sum + Number(o.customer_shipping || 0),
        0
      );

      const candidateAddress =
        candidateShipment.address && candidateShipment.address.trim() !== '-'
          ? candidateShipment.address
          : address;

      const allOrdersVerifiedPaid =
        isVerifiedFullPaid && ordersList.every((o: any) => isOrderFullyPaid(o));
      const nextBundledStatus = allOrdersVerifiedPaid
        ? 'WAITING_PACKING'
        : 'WAITING_VERIFICATION';

      await prisma.shipment.update({
        where: { id: candidateShipment.id },
        data: {
          status: nextBundledStatus as any,
          shipping_cost: combinedShippingCost,
          address: candidateAddress,
          notes: fullItemsSummary
            ? `Item to pack: ${fullItemsSummary}`
            : candidateShipment.notes,
        },
      });
      return;
    } catch (err) {
      console.error(
        `[ensureShipmentForOrderHelper] Failed to bundle order ${order.id} into shipment ${candidateShipment.id}. Creating new shipment fallback.`,
        err
      );
    }
  }

  const effectiveShippingMethod =
    order.shipping_method || linkedInvoice?.shipping_method || 'MANUAL';
  const isShopee = effectiveShippingMethod === 'SHOPEE';
  const manualCourier =
    order.shipping_courier || linkedInvoice?.shipping_courier || 'JNE';
  const manualService =
    order.shipping_service || linkedInvoice?.shipping_service || null;
  const shopeeUsername =
    order.shopee_username || linkedInvoice?.shopee_username || null;
  const shopeeOrderNo =
    order.shopee_order_no || linkedInvoice?.shopee_order_no || null;
  const shopeeVariant =
    order.shopee_variant || linkedInvoice?.shopee_variant || null;

  const defaultCourier = isShopee ? 'Shopee (Checkout Shopee)' : manualCourier;
  const defaultService = isShopee ? 'Checkout Shopee' : manualService;
  const shopeeNote = isShopee
    ? ` [Kirim via Shopee${shopeeOrderNo ? ` - No. Pesanan: ${shopeeOrderNo}` : ''}${shopeeVariant ? ` - Varian: ${shopeeVariant}` : ''}]`
    : '';

  let initialTrackingNumber: string | null = null;
  if (isShopee && shopeeOrderNo) {
    const existingTracking = await prisma.shipment.findFirst({
      where: { tracking_number: shopeeOrderNo },
    });
    if (!existingTracking) {
      initialTrackingNumber = shopeeOrderNo;
    }
  }

  let matchedCounterId: number | null = null;
  if (!isShopee && manualCourier) {
    const counter = await prisma.shipping_counter.findFirst({
      where: {
        deleted_at: null,
        is_active: true,
        name: { equals: manualCourier, mode: 'insensitive' },
      },
    });
    if (counter) matchedCounterId = counter.id;
  }

  // Create new shipment
  const newShipment = await prisma.shipment.create({
    data: {
      order_id: order.id,
      customer_id: order.customer_id,
      address,
      courier: defaultCourier,
      service_type: defaultService,
      shipping_counter_id: matchedCounterId,
      shipping_method: effectiveShippingMethod,
      shopee_username: shopeeUsername,
      shopee_order_no: isShopee ? shopeeOrderNo : null,
      shopee_variant: isShopee ? shopeeVariant : null,
      tracking_number: initialTrackingNumber,
      shipping_cost: order.customer_shipping || 0,
      status: targetInitialStatus as any,
      notes:
        (itemsSummary
          ? `Item to pack: ${itemsSummary}`
          : `Pengiriman otomatis dibuat untuk pesanan ${order.order_number}.`) + shopeeNote,
    },
  });

  await prisma.shipment_order.create({
    data: {
      shipment_id: newShipment.id,
      order_id: order.id,
    },
  });
}
