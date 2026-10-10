import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, Client } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://postgres:P@ssw0rd@localhost:5435/worthtobuy_db?schema=public' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  const oldClient = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5433/worthtobuy?schema=public'
  });
  
  try {
    await oldClient.connect();
    console.log('Connected to old DB');
  } catch (err) {
    console.error('Failed to connect to old DB:', err.message);
    return;
  }

  const tables = [
    'User',
    'Customer',
    'CustomerAddress',
    'Product',
    'JastipPeriod',
    'Order',
    'OrderItem',
    'Invoice',
    'InvoiceOrder',
    'Payment',
    'Expense',
    'Shipment',
    'Refund',
    'InventoryMovement',
    'Currency',
    'ExchangeRate',
    'Notification',
    'ActivityLog',
    'Setting'
  ];

  for (const table of tables) {
    try {
      const { rows: tableExists } = await oldClient.query(`SELECT to_regclass('public."${table}"') as exists`);
      if (!tableExists[0].exists) {
        console.log(`Table ${table} does not exist in old DB, skipping...`);
        continue;
      }

      console.log(`Migrating ${table}...`);
      const { rows } = await oldClient.query(`SELECT * FROM "${table}"`);
      
      if (rows.length > 0) {
        const delegate = prisma[table.charAt(0).toLowerCase() + table.slice(1)];
        if (delegate) {
          // ensure no extra fields
          await delegate.createMany({
             data: rows,
             skipDuplicates: true
          });
          console.log(`Inserted ${rows.length} records into ${table}`);
        } else {
          console.log(`Model ${table} not found in new Prisma client`);
        }
      }
    } catch (err) {
      console.error(`Error migrating ${table}:`, err.message);
    }
  }

  await oldClient.end();
  await prisma.$disconnect();
  await pool.end();
}

run();
