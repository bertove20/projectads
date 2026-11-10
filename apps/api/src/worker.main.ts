import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AlertService } from './alerts/alert.service';
import { NotificationService } from './alerts/notification.service';
import { CoreModule, REDIS } from './common/core.module';
import { loggerModule } from './common/logger';
import { networkSyncQueueProvider, notifyQueueProvider, postbackQueueProvider } from './common/queues';
import { NetworkSyncService } from './networks/network-sync.service';
import { DeliveryService } from './postbacks/delivery.service';
import { WorkerService } from './worker/worker.service';
import { TasksService } from './tasks/tasks.service';
import { DomainsService } from './domains/domains.service';
import { dnsResolverProvider } from './domains/resolver.provider';

/** Proses "worker": postback keluar, sinkronisasi jaringan, notifikasi, dan tugas berkala. */
@Module({
  imports: [loggerModule('worker'), CoreModule],
  providers: [
    DeliveryService,
    NetworkSyncService,
    NotificationService,
    AlertService,
    TasksService,
    DomainsService,
    dnsResolverProvider,
    WorkerService,
    postbackQueueProvider(REDIS),
    networkSyncQueueProvider(REDIS),
    notifyQueueProvider(REDIS),
  ],
})
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

void bootstrap();
