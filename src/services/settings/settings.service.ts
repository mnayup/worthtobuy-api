import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) { }

  async getAll() {
    const data = await this.prisma.setting.findMany();
    return Object.fromEntries(data.map(x => [x.key, x.value]));
  }

  async updateKey(key: string, value: any) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
