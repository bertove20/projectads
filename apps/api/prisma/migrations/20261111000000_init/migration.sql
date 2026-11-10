-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('ALL', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('CAMPAIGN', 'WEBSITE', 'NETWORK_ACCOUNT');

-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PayoutType" AS ENUM ('CPA', 'CPL', 'CPI', 'REVSHARE', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "AdNetwork" AS ENUM ('ROLLERADS', 'CLICKADU', 'PROPELLERADS', 'EVADAV', 'META', 'GOOGLE', 'OTHER');

-- CreateEnum
CREATE TYPE "CredentialKind" AS ENUM ('API_TOKEN', 'POSTBACK_TEMPLATE');

-- CreateEnum
CREATE TYPE "AdFormat" AS ENUM ('PUSH', 'ONCLICK', 'IN_PAGE_PUSH', 'DIRECT_CLICK', 'NATIVE', 'BANNER', 'INTERSTITIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "BidModel" AS ENUM ('CPC', 'SMART_CPC', 'CPA_GOAL_CPC', 'CPM', 'SMART_CPM', 'CPA_GOAL_CPM', 'CPA', 'OTHER');

-- CreateEnum
CREATE TYPE "FlowType" AS ENUM ('DIRECT', 'LANDING');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('RECEIVED', 'OBSERVED', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ConversionSource" AS ENUM ('INBOUND_POSTBACK', 'SDK', 'MANUAL');

-- CreateEnum
CREATE TYPE "InboundResult" AS ENUM ('ACCEPTED', 'UPDATED', 'DUPLICATE', 'UNKNOWN_CLICK', 'INVALID', 'FORBIDDEN_IP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'DELIVERED', 'FAILED', 'DEAD', 'TEST_SKIPPED');

-- CreateEnum
CREATE TYPE "SpendSource" AS ENUM ('MANUAL', 'CSV', 'API');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "mfa_verified" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'ASSIGNED',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_assignments" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "resource_type" "ResourceType" NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "websites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_pages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "website_id" UUID,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_networks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "postback_token_hash" TEXT NOT NULL,
    "allowed_ips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "param_mapping" JSONB NOT NULL DEFAULT '{}',
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_networks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "affiliate_network_id" UUID,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payout_type" "PayoutType" NOT NULL DEFAULT 'CPA',
    "payout_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "geos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "network" "AdNetwork" NOT NULL,
    "name" TEXT NOT NULL,
    "param_mapping" JSONB NOT NULL DEFAULT '{}',
    "postback_configured" BOOLEAN NOT NULL DEFAULT false,
    "postback_success_pattern" TEXT,
    "test_mode" BOOLEAN NOT NULL DEFAULT true,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encrypted_credentials" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "network_account_id" UUID,
    "kind" "CredentialKind" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "hint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMP(3),

    CONSTRAINT "encrypted_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "network_account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "external_campaign_id" TEXT,
    "ad_format" "AdFormat" NOT NULL,
    "ad_format_network" TEXT,
    "bid_model" "BidModel" NOT NULL,
    "bid_amount" DECIMAL(18,6),
    "target_cpa" DECIMAL(18,6),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "flow_type" "FlowType" NOT NULL DEFAULT 'DIRECT',
    "offer_id" UUID,
    "landing_page_id" UUID,
    "fallback_url" TEXT,
    "conversion_goal" TEXT NOT NULL DEFAULT 'default',
    "postback_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "ActiveStatus" NOT NULL DEFAULT 'PAUSED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clicks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "offer_id" UUID,
    "landing_page_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "external_click_id" TEXT,
    "zone_id" TEXT,
    "sub_id" TEXT,
    "creative_id" TEXT,
    "feed_id" TEXT,
    "cost" DECIMAL(18,6),
    "country" CHAR(2),
    "device_type" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "ip_hash" TEXT,
    "referrer_domain" TEXT,
    "extra_params" JSONB,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "bot_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "click_out_at" TIMESTAMP(3),

    CONSTRAINT "clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "click_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "offer_id" UUID,
    "affiliate_network_id" UUID,
    "goal" TEXT NOT NULL DEFAULT 'default',
    "idempotency_key" TEXT NOT NULL,
    "transaction_id" TEXT,
    "status" "ConversionStatus" NOT NULL,
    "source" "ConversionSource" NOT NULL,
    "payout" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_adjustments" (
    "id" UUID NOT NULL,
    "conversion_id" UUID NOT NULL,
    "from_status" "ConversionStatus" NOT NULL,
    "to_status" "ConversionStatus" NOT NULL,
    "from_payout" DECIMAL(18,6) NOT NULL,
    "to_payout" DECIMAL(18,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_postbacks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "affiliate_network_id" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "method" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "result" "InboundResult" NOT NULL,
    "message" TEXT,
    "conversion_id" UUID,

    CONSTRAINT "inbound_postbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postback_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversion_id" UUID NOT NULL,
    "network_account_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "target_host" TEXT,
    "last_status_code" INTEGER,
    "last_response" TEXT,
    "last_error" TEXT,
    "provider_accepted" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "postback_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "source" "SpendSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spend_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE INDEX "memberships_organization_id_idx" ON "memberships"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_organization_id_key" ON "memberships"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "resource_assignments_resource_type_resource_id_idx" ON "resource_assignments"("resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_assignments_membership_id_resource_type_resource_i_key" ON "resource_assignments"("membership_id", "resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "websites_organization_id_domain_key" ON "websites"("organization_id", "domain");

-- CreateIndex
CREATE INDEX "landing_pages_organization_id_idx" ON "landing_pages"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_networks_postback_token_hash_key" ON "affiliate_networks"("postback_token_hash");

-- CreateIndex
CREATE INDEX "affiliate_networks_organization_id_idx" ON "affiliate_networks"("organization_id");

-- CreateIndex
CREATE INDEX "offers_organization_id_idx" ON "offers"("organization_id");

-- CreateIndex
CREATE INDEX "network_accounts_organization_id_idx" ON "network_accounts"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "encrypted_credentials_network_account_id_kind_key" ON "encrypted_credentials"("network_account_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_token_key" ON "campaigns"("token");

-- CreateIndex
CREATE INDEX "campaigns_organization_id_status_idx" ON "campaigns"("organization_id", "status");

-- CreateIndex
CREATE INDEX "clicks_organization_id_created_at_idx" ON "clicks"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "clicks_campaign_id_created_at_idx" ON "clicks"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "clicks_campaign_id_ip_hash_created_at_idx" ON "clicks"("campaign_id", "ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "clicks_campaign_id_zone_id_idx" ON "clicks"("campaign_id", "zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_idempotency_key_key" ON "conversions"("idempotency_key");

-- CreateIndex
CREATE INDEX "conversions_organization_id_created_at_idx" ON "conversions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "conversions_campaign_id_created_at_idx" ON "conversions"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "conversions_click_id_idx" ON "conversions"("click_id");

-- CreateIndex
CREATE INDEX "conversion_adjustments_conversion_id_idx" ON "conversion_adjustments"("conversion_id");

-- CreateIndex
CREATE INDEX "inbound_postbacks_organization_id_received_at_idx" ON "inbound_postbacks"("organization_id", "received_at");

-- CreateIndex
CREATE INDEX "inbound_postbacks_affiliate_network_id_received_at_idx" ON "inbound_postbacks"("affiliate_network_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "postback_deliveries_idempotency_key_key" ON "postback_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "postback_deliveries_organization_id_created_at_idx" ON "postback_deliveries"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "postback_deliveries_status_updated_at_idx" ON "postback_deliveries"("status", "updated_at");

-- CreateIndex
CREATE INDEX "spend_entries_organization_id_date_idx" ON "spend_entries"("organization_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "spend_entries_campaign_id_date_source_key" ON "spend_entries"("campaign_id", "date", "source");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "websites" ADD CONSTRAINT "websites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_networks" ADD CONSTRAINT "affiliate_networks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_affiliate_network_id_fkey" FOREIGN KEY ("affiliate_network_id") REFERENCES "affiliate_networks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_accounts" ADD CONSTRAINT "network_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_credentials" ADD CONSTRAINT "encrypted_credentials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_credentials" ADD CONSTRAINT "encrypted_credentials_network_account_id_fkey" FOREIGN KEY ("network_account_id") REFERENCES "network_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_network_account_id_fkey" FOREIGN KEY ("network_account_id") REFERENCES "network_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "landing_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "landing_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_click_id_fkey" FOREIGN KEY ("click_id") REFERENCES "clicks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_affiliate_network_id_fkey" FOREIGN KEY ("affiliate_network_id") REFERENCES "affiliate_networks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_adjustments" ADD CONSTRAINT "conversion_adjustments_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "conversions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_postbacks" ADD CONSTRAINT "inbound_postbacks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_postbacks" ADD CONSTRAINT "inbound_postbacks_affiliate_network_id_fkey" FOREIGN KEY ("affiliate_network_id") REFERENCES "affiliate_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postback_deliveries" ADD CONSTRAINT "postback_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postback_deliveries" ADD CONSTRAINT "postback_deliveries_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "conversions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postback_deliveries" ADD CONSTRAINT "postback_deliveries_network_account_id_fkey" FOREIGN KEY ("network_account_id") REFERENCES "network_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

