# WORTHTOBUY Backend API (NestJS + Prisma + PostgreSQL)

Backend service untuk platform WORTHTOBUY Jastip Management Control Center, dibangun menggunakan **NestJS**, **Prisma ORM**, dan **PostgreSQL**.

---

## 🚀 Fitur Backend

- **NestJS Framework Architecture**: Modular dan maintainable (Auth, Dashboard, Periods, Customers, Products, Orders, OrderItems, Purchases, ShoppingList, Payments, Invoices, Shipments, Expenses, Refunds, Reports, Search, Users, Settings, AuditLogs, Notifications, Trash, AI).
- **Prisma ORM & PostgreSQL**: Schema relasional lengkap mencakup order workflow, multi-order invoicing, inventory tracking, dan soft-delete recovery.
- **Role-Based Access Control (RBAC)**: Guard JWT terintegrasi dengan role `OWNER`, `ADMIN`, `SHOPPER`, `FINANCE`.
- **WORTHTOBUY AI Assistant**: Endpoint AI terintegrasi dengan Google Gemini dan contextual engine berbasis intent & role security scope.
- **Automated Workflows**: Automatic tiered fee preview, auto-refund untuk barang tidak dapat / kelebihan bayar, real-time stock reservation, dan reminder jatuh tempo pembayaran.

---

## 🛠️ Prasyarat

- **Node.js**: v18+ (disarankan Node 20 atau 24)
- **PostgreSQL**: v14+ (lokal atau via Docker di port 5433)

---

## ⚙️ Panduan Instalasi & Menjalankan

### 1. Masuk ke folder proyek
```bash
cd worthtobuy-api
```

### 2. Konfigurasi Environment (`.env`)
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```

Pastikan variabel database sesuai:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/worthtobuy?schema=public"
API_PORT=4000
JWT_SECRET=super-secret-jwt-key-worthtobuy-change-me-32chars
OWNER_NAME="Owner WORTHTOBUY"
OWNER_EMAIL="owner@worthtobuy.local"
OWNER_PASSWORD="GantiPassword123!"
```

### 3. Menjalankan Database PostgreSQL (Docker Compose)
```bash
docker compose up -d
```

### 4. Generate Prisma Client & Migrasi Database
```bash
yarn prisma:generate
yarn dlx prisma db push
yarn seed
```

### 5. Menjalankan Server Development
```bash
yarn start:dev
```
Server akan aktif di: **http://localhost:4000**  
Health check: **http://localhost:4000/health**

---

## 📜 Kredensial Default Login
- **Email**: `owner@worthtobuy.local`
- **Password**: `GantiPassword123!`
