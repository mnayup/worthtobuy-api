import { PrismaClient, PeriodStatus, PeriodType, ProductMode, OrderStatus, InvoiceStatus, ShipmentStatus, ItemFulfillmentStatus } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:P@ssw0rd@localhost:5435/worthtobuy_db?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function seed() {
  console.log('Seeding public portal data (Events, Ready Stock, Sample Orders)...');

  // 1. Events (Jastip Periods)
  const eventsData = [
    {
      code: 'IMBEX-2026',
      name: 'IMBEX 2026 - Maternity, Baby & Kids Expo',
      type: PeriodType.LOCAL,
      country: 'Indonesia',
      city: 'Jakarta (JCC Senayan)',
      order_open_at: new Date(Date.now() - 3 * 86400000),
      order_close_at: new Date(Date.now() + 4 * 86400000),
      departure_at: new Date(Date.now() - 1 * 86400000),
      return_at: new Date(Date.now() + 5 * 86400000),
      estimated_shipping_at: new Date(Date.now() + 7 * 86400000),
      status: PeriodStatus.OPEN,
      notes: 'Pameran perlengkapan bayi dan ibu hamil terbesar se-Indonesia! Diskon up to 80% Pigeon, Mothercare, Chicco, Dr. Brown, dsb. Pengiriman cepat langsung dari Central HQ.',
    },
    {
      code: 'WILBEX-2026',
      name: 'WILBEX 2026 - Warehouse Branded Expo',
      type: PeriodType.LOCAL,
      country: 'Indonesia',
      city: 'Tangerang (ICE BSD)',
      order_open_at: new Date(Date.now() - 2 * 86400000),
      order_close_at: new Date(Date.now() + 5 * 86400000),
      departure_at: new Date(Date.now() + 1 * 86400000),
      return_at: new Date(Date.now() + 6 * 86400000),
      estimated_shipping_at: new Date(Date.now() + 8 * 86400000),
      status: PeriodStatus.OPEN,
      notes: 'Warehouse sale fashion, luggage, sneaker, dan aksesoris branded. Live shopping via WhatsApp dan IG Story.',
    },
    {
      code: 'BKK-TRIP-26',
      name: 'Bangkok Viral Snacks & Fashion Shopping Trip',
      type: PeriodType.INTERNATIONAL,
      country: 'Thailand',
      city: 'Bangkok (Platinum & Siam)',
      order_open_at: new Date(Date.now() - 1 * 86400000),
      order_close_at: new Date(Date.now() + 8 * 86400000),
      departure_at: new Date(Date.now() + 10 * 86400000),
      return_at: new Date(Date.now() + 14 * 86400000),
      estimated_shipping_at: new Date(Date.now() + 16 * 86400000),
      status: PeriodStatus.OPEN,
      currency_code: 'THB',
      exchange_rate: 465,
      notes: 'Trip belanja Bangkok langsung! Snack Big Roll Tao Kae Noi, Milk Candy, Gentle Woman bag, Thai tea powder, dan kosmetik viral.',
    },
    {
      code: 'BBW-26',
      name: 'Big Bad Wolf Books 2026',
      type: PeriodType.LOCAL,
      country: 'Indonesia',
      city: 'Jakarta (ICE BSD)',
      order_open_at: new Date(Date.now() - 5 * 86400000),
      order_close_at: new Date(Date.now() + 2 * 86400000),
      departure_at: new Date(Date.now() - 2 * 86400000),
      return_at: new Date(Date.now() + 3 * 86400000),
      estimated_shipping_at: new Date(Date.now() + 4 * 86400000),
      status: PeriodStatus.OPEN,
      notes: 'Bazar buku impor terbesar di Indonesia! Buku anak Usborne, Disney Soundbook, novel best seller, dan puzzle interaktif diskon hingga 90%.',
    },
  ];

  for (const evt of eventsData) {
    const existing = await prisma.jastip_period.findUnique({ where: { code: evt.code } });
    if (!existing) {
      await prisma.jastip_period.create({ data: evt });
      console.log(`Created event: ${evt.name}`);
    }
  }

  // 2. Ready Stock Products (Central HQ inventory)
  const readyStockItems = [
    {
      sku: 'RS-MTC-001',
      name: 'Mothercare Pure Cotton Sleepsuit 3-Pack (0-6M)',
      category: 'Perlengkapan Bayi',
      brand_name: 'Mothercare',
      store_location: 'Central HQ Warehouse',
      image_url: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=800&q=80',
      stock_mode: ProductMode.READY_STOCK,
      stock_quantity: 8,
      buy_price: 220000,
      selling_price: 285000,
      notes: '100% Organic soft cotton, anti alergi dengan proteksi kancing bebas nikel.',
    },
    {
      sku: 'RS-PGN-002',
      name: 'Pigeon SofTouch Wide Neck PPSU Bottle 240ml',
      category: 'Perlengkapan Bayi',
      brand_name: 'Pigeon',
      store_location: 'Central HQ Warehouse',
      image_url: 'https://images.unsplash.com/photo-1598256989800-fe5f95da9787?auto=format&fit=crop&w=800&q=80',
      stock_mode: ProductMode.READY_STOCK,
      stock_quantity: 15,
      buy_price: 175000,
      selling_price: 225000,
      notes: 'Bahan botol PPSU grade medis tahan panas hingga 180°C, dot ultra-soft silicone.',
    },
    {
      sku: 'RS-SMG-003',
      name: 'Smiggle Beyond Hardtop Curve Pencil Case (Pastel Stars)',
      category: 'Alat Tulis & Mainan',
      brand_name: 'Smiggle',
      store_location: 'Central HQ Warehouse',
      image_url: 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?auto=format&fit=crop&w=800&q=80',
      stock_mode: ProductMode.READY_STOCK,
      stock_quantity: 6,
      buy_price: 280000,
      selling_price: 350000,
      notes: 'Desain embossed 3D timbul, double zipper kokoh, dan kompartemen jaring elastis.',
    },
    {
      sku: 'RS-USB-004',
      name: 'Usborne "Look Inside Your Body" Flap Interactive Boardbook',
      category: 'Buku & Edukasi',
      brand_name: 'Usborne Books',
      store_location: 'Central HQ Warehouse',
      image_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=800&q=80',
      stock_mode: ProductMode.READY_STOCK,
      stock_quantity: 10,
      buy_price: 135000,
      selling_price: 185000,
      notes: 'Lebih dari 100 flap interaktif untuk edukasi anatomi tubuh anak secara seru dan visual.',
    },
    {
      sku: 'RS-STN-005',
      name: 'Stanley Quencher H2.0 FlowState Tumbler 40oz (Rose Quartz)',
      category: 'Tumbler & Lifestyle',
      brand_name: 'Stanley',
      store_location: 'Central HQ Warehouse',
      image_url: 'https://images.unsplash.com/photo-1577937927133-66ef06acdf18?auto=format&fit=crop&w=800&q=80',
      stock_mode: ProductMode.READY_STOCK,
      stock_quantity: 4,
      buy_price: 580000,
      selling_price: 720000,
      notes: 'Insulasi vakum stainless steel ganda, tahan dingin es hingga 48 jam.',
    },
    {
      sku: 'RS-BBW-006',
      name: 'Bath & Body Works Aromatherapy Body Wash & Foam Bath (Eucalyptus Spearmint)',
      category: 'Beauty & Care',
      brand_name: 'Bath & Body Works',
      store_location: 'Central HQ Warehouse',
      image_url: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=800&q=80',
      stock_mode: ProductMode.READY_STOCK,
      stock_quantity: 12,
      buy_price: 210000,
      selling_price: 265000,
      notes: 'Wangi relaksasi spa yang menenangkan dengan formula natural essential oils.',
    },
    {
      sku: 'RS-GNH-007',
      name: 'Gentle Hour Clean Habits pH-Balancing Cleanser 100ml',
      category: 'Beauty & Care',
      brand_name: 'Gentle Hour',
      store_location: 'Central HQ Warehouse',
      image_url: 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=800&q=80',
      stock_mode: ProductMode.READY_STOCK,
      stock_quantity: 9,
      buy_price: 125000,
      selling_price: 159000,
      notes: 'Gentle facial wash tanpa SLS dengan busa lembut dan ekstrak chamomile menenangkan.',
    },
    {
      sku: 'RS-BCH-008',
      name: 'Bacha Coffee 1910 Heritage Drip Bag Assortment (12 Sachet)',
      category: 'Gourmet & Snacks',
      brand_name: 'Bacha Coffee',
      store_location: 'Central HQ Warehouse',
      image_url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80',
      stock_mode: ProductMode.READY_STOCK,
      stock_quantity: 7,
      buy_price: 320000,
      selling_price: 395000,
      notes: '100% Arabica single-origin drip bags signature Maroko, aroma karamel mewah.',
    },
  ];

  for (const item of readyStockItems) {
    const existing = await prisma.product.findUnique({ where: { sku: item.sku } });
    if (!existing) {
      await prisma.product.create({ data: item });
      console.log(`Created ready stock item: ${item.name}`);
    }
  }

  // 3. Create Sample Trackable Orders with Invoices and Shipments
  const customers = await prisma.customer.findMany({ take: 3 });
  const imbexPeriod = await prisma.jastip_period.findFirst({ where: { code: 'IMBEX-2026' } });

  if (customers.length >= 2 && imbexPeriod) {
    // Sample Order 1: INV-2026-0001 (Hunting di Venue IMBEX)
    const existingOrder1 = await prisma.order.findUnique({ where: { order_number: 'ORD-2026-0001' } });
    if (!existingOrder1) {
      const order1 = await prisma.order.create({
        data: {
          order_number: 'ORD-2026-0001',
          period_id: imbexPeriod.id,
          customer_id: customers[0].id,
          status: OrderStatus.SEARCHING,
          product_subtotal_foreign: 510000,
          product_subtotal_idr: 510000,
          service_fee: 35000,
          customer_shipping: 18000,
          total_bill: 563000,
          paid_amount: 563000,
          outstanding_amount: 0,
          customer_notes: 'Tolong pilih warna mint ya min kalau ada',
          items: {
            create: [
              {
                manual_product_name: 'Chicco Baby Moments Gentle Body Wash 500ml',
                brand_name: 'Chicco',
                quantity: 2,
                unit_price_foreign: 145000,
                target_price_idr: 145000,
                fulfillment_status: ItemFulfillmentStatus.AVAILABLE,
              },
              {
                manual_product_name: 'Dr. Brown Natural Flow Options+ Anti-Colic Bottle 270ml',
                brand_name: "Dr. Brown's",
                quantity: 1,
                unit_price_foreign: 220000,
                target_price_idr: 220000,
                fulfillment_status: ItemFulfillmentStatus.SEARCHING,
              },
            ],
          },
        },
      });

      const invoice1 = await prisma.invoice.create({
        data: {
          invoice_number: 'INV-2026-0001',
          customer_id: customers[0].id,
          status: InvoiceStatus.PAID,
          total_bill: 563000,
          paid_amount: 563000,
          outstanding_amount: 0,
          orders: {
            create: {
              order_id: order1.id,
              snapshot_amount: 563000,
            },
          },
          payments: {
            create: {
              payment_number: 'PAY-2026-0001',
              amount: 563000,
              method: 'BCA Transfer',
              destination_account: 'BCA 0882199212 (Worthtobuy)',
              order_id: order1.id,
            },
          },
        },
      });
      console.log(`Created sample Order 1: ${order1.order_number} with Invoice ${invoice1.invoice_number}`);
    }

    // Sample Order 2: INV-2026-0002 (Dalam Pengiriman SiCepat Resi 004289104829)
    const existingOrder2 = await prisma.order.findUnique({ where: { order_number: 'ORD-2026-0002' } });
    if (!existingOrder2) {
      const order2 = await prisma.order.create({
        data: {
          order_number: 'ORD-2026-0002',
          period_id: imbexPeriod.id,
          customer_id: customers[1].id,
          status: OrderStatus.SHIPPED,
          product_subtotal_foreign: 720000,
          product_subtotal_idr: 720000,
          service_fee: 40000,
          customer_shipping: 25000,
          total_bill: 785000,
          paid_amount: 785000,
          outstanding_amount: 0,
          items: {
            create: [
              {
                manual_product_name: 'Stanley Quencher H2.0 FlowState 40oz (Rose Quartz)',
                brand_name: 'Stanley',
                quantity: 1,
                unit_price_foreign: 720000,
                target_price_idr: 720000,
                fulfillment_status: ItemFulfillmentStatus.SHIPPED,
              },
            ],
          },
          shipments: {
            create: {
              tracking_number: '004289104829',
              customer_id: customers[1].id,
              courier: 'SiCepat Ekspres',
              service_type: 'REG (Reguler Delivery)',
              weight_kg: 1.2,
              shipping_cost: 25000,
              address: 'Jakarta, Indonesia',
              shipped_at: new Date(Date.now() - 12 * 3600000),
              status: ShipmentStatus.IN_TRANSIT,
            },
          },
        },
      });

      const invoice2 = await prisma.invoice.create({
        data: {
          invoice_number: 'INV-2026-0002',
          customer_id: customers[1].id,
          status: InvoiceStatus.PAID,
          total_bill: 785000,
          paid_amount: 785000,
          outstanding_amount: 0,
          orders: {
            create: {
              order_id: order2.id,
              snapshot_amount: 785000,
            },
          },
          payments: {
            create: {
              payment_number: 'PAY-2026-0002',
              amount: 785000,
              method: 'QRIS BCA',
              destination_account: 'QRIS Worthtobuy Official',
              order_id: order2.id,
            },
          },
        },
      });
      console.log(`Created sample Order 2: ${order2.order_number} with Invoice ${invoice2.invoice_number} and Tracking 004289104829`);
    }
  }

  console.log('Seeding completed successfully!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
