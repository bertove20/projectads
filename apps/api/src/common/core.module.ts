import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, Env, loadEnv } from '../config/env';
import { AuditService } from './audit/audit.service';
import { CryptoService } from './crypto/crypto.service';
import { PrismaService } from './prisma/prisma.service';

export const REDIS = Symbol('REDIS');

/** Layanan bersama untuk proses api, tracker, dan worker. */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, {
          // wajib null untuk BullMQ; juga mencegah request tracking menggantung lama
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          lazyConnect: false,
        }),
    },
    PrismaService,
    CryptoService,
    AuditService,
  ],
  exports: [ENV, REDIS, PrismaService, CryptoService, AuditService],
})
export class CoreModule {}
