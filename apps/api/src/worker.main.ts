import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AlertService } from './alerts/alert.service';
import { NotificationService } from './alerts/notification.service';
import { CoreModule, REDIS } from './common/core.module';
import { loggerModule } from './common/logger';
import { aiTeamQueueProvider, networkSyncQueueProvider, notifyQueueProvider, postbackQueueProvider } from './common/queues';
import { AiService } from './ai/ai.service';
import { AiToolsService } from './ai/ai-tools';
import { AiTeamService } from './ai/team.service';
import { TeamMemoryService } from './ai/team-memory.service';
import { ChatNotifier } from './chat/chat-notifier.service';
import { ChatCommandService } from './chat/chat-command.service';
import { TelegramPoller } from './chat/telegram-poller.service';
import { AnalyticsService } from './reports/analytics.service';
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
    AnalyticsService,
    AiService,
    AiToolsService,
    AiTeamService,
    TeamMemoryService,
    ChatNotifier,
    ChatCommandService,
    TelegramPoller,
    DomainsService,
    dnsResolverProvider,
    WorkerService,
    postbackQueueProvider(REDIS),
    networkSyncQueueProvider(REDIS),
    notifyQueueProvider(REDIS),
    aiTeamQueueProvider(REDIS),
  ],
})
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

void bootstrap();
