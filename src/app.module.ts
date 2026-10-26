import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './config/prisma/prisma.module';
import { AuthModule } from './services/auth/auth.module';
import { DashboardModule } from './services/dashboard/dashboard.module';
import { PeriodsModule } from './services/periods/periods.module';
import { CustomersModule } from './services/customers/customers.module';
import { ProductsModule } from './services/products/products.module';
import { OrdersModule } from './services/orders/orders.module';
import { OrderItemsModule } from './services/order-items/order-items.module';
import { PurchasesModule } from './services/purchases/purchases.module';
import { ShoppingListModule } from './services/shopping-list/shopping-list.module';
import { PaymentsModule } from './services/payments/payments.module';
import { InvoicesModule } from './services/invoices/invoices.module';
import { ShipmentsModule } from './services/shipments/shipments.module';
import { ShippingCountersModule } from './services/shipping-counters/shipping-counters.module';
import { WhatsappGroupsModule } from './services/whatsapp-groups/whatsapp-groups.module';
import { ExpensesModule } from './services/expenses/expenses.module';
import { RefundsModule } from './services/refunds/refunds.module';
import { ReportsModule } from './services/reports/reports.module';
import { SearchModule } from './services/search/search.module';
import { UsersModule } from './services/users/users.module';
import { RolesModule } from './services/roles/roles.module';
import { SettingsModule } from './services/settings/settings.module';
import { NotificationsModule } from './services/notifications/notifications.module';
import { TrashModule } from './services/trash/trash.module';
import { NavigationModule } from './services/navigation/navigation.module';
import { ReminderService } from './services/shared/reminder.service';
import { InitialSetupService } from './services/shared/initial-setup.service';
import { UploadsModule } from './services/uploads/uploads.module';
import { PublicModule } from './services/public/public.module';

import { BackupModule } from './services/backup/backup.module';

@Module({
  imports: [
    BackupModule,
    UploadsModule,
    PublicModule,

    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    DashboardModule,
    PeriodsModule,
    CustomersModule,
    ProductsModule,
    OrdersModule,
    OrderItemsModule,
    PurchasesModule,
    ShoppingListModule,
    PaymentsModule,
    InvoicesModule,
    ShipmentsModule,
    ShippingCountersModule,
    WhatsappGroupsModule,
    ExpensesModule,
    RefundsModule,
    ReportsModule,
    SearchModule,
    UsersModule,
    RolesModule,
    SettingsModule,
    NotificationsModule,
    TrashModule,
    NavigationModule,
  ],
  providers: [ReminderService, InitialSetupService],
})
export class AppModule { }
