import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Proses tetap menyala walau database belum tersedia saat start (read.md 17.10):
   * Prisma akan terhubung otomatis pada query berikutnya. Tracker tetap bisa redirect
   * dan menyimpan klik ke buffer Redis selama database mati.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Database belum tersedia saat start; akan mencoba lagi saat query berikutnya');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
