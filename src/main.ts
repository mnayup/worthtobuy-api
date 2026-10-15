import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as morgan from 'morgan';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';
import { SerializeInterceptor } from './common/interceptors/serialize.interceptor';
import { ReminderService } from './services/shared/reminder.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.enableCors({ origin: true, credentials: true });
  app.use(morgan('dev'));

  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalInterceptors(new SerializeInterceptor());

  // Health check
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: any, res: any) => {
    res.json({ status: 'ok', service: 'worthtobuy-api', framework: 'nestjs' });
  });

  const reminderService = app.get(ReminderService);
  reminderService.syncPaymentReminders().catch(err => console.error('Gagal sync reminder:', err));
  const reminderTimer = setInterval(() => {
    reminderService.syncPaymentReminders().catch(err => console.error('Gagal sync reminder:', err));
  }, 60 * 60 * 1000);
  reminderTimer.unref();

  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  console.log(`WorthToBuy API Running on PORT ${port}`);
}

bootstrap();
