-- CreateEnum
CREATE TYPE "TrackingEventType" AS ENUM ('PAGE_VIEW', 'LANDING_VIEW', 'REGISTRATION_STARTED', 'REGISTRATION_SUBMITTED', 'REGISTRATION_SUCCESS_OBSERVED', 'CUSTOM_EVENT');

-- AlterTable
ALTER TABLE "clicks" ADD COLUMN     "language" VARCHAR(8),
ADD COLUMN     "route_id" UUID,
ADD COLUMN     "variant_id" UUID;

-- AlterTable
ALTER TABLE "websites" ADD COLUMN     "extra_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "require_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sdk_key" TEXT;

-- CreateTable
CREATE TABLE "campaign_routes" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_variants" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "offer_id" UUID NOT NULL,
    "landing_page_id" UUID,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "click_id" UUID,
    "campaign_id" UUID,
    "event_id" TEXT NOT NULL,
    "session_id" TEXT,
    "type" "TrackingEventType" NOT NULL,
    "name" TEXT,
    "path" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "props" JSONB,
    "ip_hash" TEXT,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_routes_campaign_id_priority_idx" ON "campaign_routes"("campaign_id", "priority");

-- CreateIndex
CREATE INDEX "route_variants_route_id_idx" ON "route_variants"("route_id");

-- CreateIndex
CREATE INDEX "tracking_events_organization_id_occurred_at_idx" ON "tracking_events"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "tracking_events_campaign_id_type_occurred_at_idx" ON "tracking_events"("campaign_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "tracking_events_click_id_idx" ON "tracking_events"("click_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_events_website_id_event_id_key" ON "tracking_events"("website_id", "event_id");

-- CreateIndex
CREATE INDEX "clicks_variant_id_idx" ON "clicks"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "websites_sdk_key_key" ON "websites"("sdk_key");

-- AddForeignKey
ALTER TABLE "campaign_routes" ADD CONSTRAINT "campaign_routes_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_variants" ADD CONSTRAINT "route_variants_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "campaign_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_variants" ADD CONSTRAINT "route_variants_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_variants" ADD CONSTRAINT "route_variants_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "landing_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

