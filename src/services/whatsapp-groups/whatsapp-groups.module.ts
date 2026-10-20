import { Module } from '@nestjs/common';
import { WhatsappGroupsController } from './whatsapp-groups.controller';
import { WhatsappGroupsService } from './whatsapp-groups.service';

@Module({
  controllers: [WhatsappGroupsController],
  providers: [WhatsappGroupsService],
  exports: [WhatsappGroupsService],
})
export class WhatsappGroupsModule {}
