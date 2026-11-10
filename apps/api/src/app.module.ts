import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard, PermissionGuard } from './auth/guards';
import { SessionService } from './auth/session.service';
import { AffiliatesController } from './catalog/affiliates.controller';
import { CampaignsController } from './catalog/campaigns.controller';
import { NetworksController } from './catalog/networks.controller';
import { RoutesController } from './catalog/routes.controller';
import { WebsitesController } from './catalog/websites.controller';
import { CoreModule, REDIS } from './common/core.module';
import { loggerModule } from './common/logger';
import { networkSyncQueueProvider, notifyQueueProvider, postbackQueueProvider } from './common/queues';
import { AlertService } from './alerts/alert.service';
import { AlertsController } from './alerts/alerts.controller';
import { HealthController } from './health.controller';
import { IntegrationController } from './networks/integration.controller';
import { NetworkSyncService } from './networks/network-sync.service';
import { OrganizationsController } from './organizations/organizations.controller';
import { AnalyticsService } from './reports/analytics.service';
import { NetworkReportsController } from './reports/network-reports.controller';
import { ReportsController } from './reports/reports.controller';

/** Proses "api": REST API untuk dashboard (/api/v1/*). */
@Module({
  imports: [
    loggerModule('api'),
    CoreModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
  ],
  controllers: [
    HealthController,
    AuthController,
    OrganizationsController,
    WebsitesController,
    AffiliatesController,
    NetworksController,
    CampaignsController,
    RoutesController,
    ReportsController,
    IntegrationController,
    NetworkReportsController,
    AlertsController,
  ],
  providers: [
    SessionService,
    AuthService,
    AnalyticsService,
    AlertService,
    NetworkSyncService,
    AuthGuard,
    postbackQueueProvider(REDIS),
    networkSyncQueueProvider(REDIS),
    notifyQueueProvider(REDIS),
    // Urutan guard: rate limit → autentikasi → permission
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
