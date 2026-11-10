-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ZoneListType" AS ENUM ('BLACKLIST', 'WHITELIST');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TELEGRAM');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "network_accounts" ADD COLUMN     "api_configured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "external_account_id" TEXT,
ADD COLUMN     "last_sync_at" TIMESTAMP(3),
ADD COLUMN     "last_sync_error" TEXT,
ADD COLUMN     "last_sync_status" "SyncStatus",
ADD COLUMN     "network_currency" CHAR(3),
ADD COLUMN     "network_timezone" TEXT,
ADD COLUMN     "sync_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "network_stats_daily" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "network_account_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "external_campaign_id" TEXT NOT NULL,
    "campaign_id" UUID,
    "zone_id" TEXT NOT NULL DEFAULT '',
    "country" VARCHAR(2) NOT NULL DEFAULT '',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "network_account_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "range_from" DATE NOT NULL,
    "range_to" DATE NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "rows_upserted" INTEGER NOT NULL DEFAULT 0,
    "unmapped_campaigns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_list_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "network_account_id" UUID NOT NULL,
    "campaign_id" UUID,
    "zone_id" TEXT NOT NULL,
    "list_type" "ZoneListType" NOT NULL,
    "reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "entity_type" TEXT,
    "entity_id" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_id" UUID,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "secret_hint" TEXT,
    "min_severity" "Severity" NOT NULL DEFAULT 'WARNING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_test_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "network_stats_daily_organization_id_date_idx" ON "network_stats_daily"("organization_id", "date");

-- CreateIndex
CREATE INDEX "network_stats_daily_campaign_id_date_idx" ON "network_stats_daily"("campaign_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "network_stats_daily_network_account_id_date_external_campai_key" ON "network_stats_daily"("network_account_id", "date", "external_campaign_id", "zone_id", "country");

-- CreateIndex
CREATE INDEX "sync_runs_network_account_id_started_at_idx" ON "sync_runs"("network_account_id", "started_at");

-- CreateIndex
CREATE INDEX "zone_list_entries_network_account_id_campaign_id_idx" ON "zone_list_entries"("network_account_id", "campaign_id");

-- CreateIndex
CREATE INDEX "zone_list_entries_organization_id_idx" ON "zone_list_entries"("organization_id");

-- CreateIndex
CREATE INDEX "alerts_organization_id_status_created_at_idx" ON "alerts"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_organization_id_dedupe_key_key" ON "alerts"("organization_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "notification_channels_organization_id_idx" ON "notification_channels"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_alert_id_channel_id_key" ON "notification_deliveries"("alert_id", "channel_id");

-- AddForeignKey
ALTER TABLE "network_stats_daily" ADD CONSTRAINT "network_stats_daily_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_stats_daily" ADD CONSTRAINT "network_stats_daily_network_account_id_fkey" FOREIGN KEY ("network_account_id") REFERENCES "network_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_network_account_id_fkey" FOREIGN KEY ("network_account_id") REFERENCES "network_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_list_entries" ADD CONSTRAINT "zone_list_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_list_entries" ADD CONSTRAINT "zone_list_entries_network_account_id_fkey" FOREIGN KEY ("network_account_id") REFERENCES "network_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_list_entries" ADD CONSTRAINT "zone_list_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

