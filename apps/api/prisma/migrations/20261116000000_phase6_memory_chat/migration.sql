-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('OUTCOME', 'LESSON', 'FEEDBACK', 'NOTE');

-- CreateEnum
CREATE TYPE "ChatPlatform" AS ENUM ('TELEGRAM', 'DISCORD');

-- AlterEnum
ALTER TYPE "ChannelType" ADD VALUE 'DISCORD';

-- AlterTable
ALTER TABLE "ai_proposals" ADD COLUMN     "outcome_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ai_runs" ADD COLUMN     "origin" JSONB;

-- AlterTable
ALTER TABLE "notification_channels" ADD COLUMN     "commands_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "config" JSONB,
ADD COLUMN     "poll_offset" BIGINT,
ADD COLUMN     "team_updates" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ai_agent_memories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "agent_id" UUID,
    "kind" "MemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "run_id" UUID,
    "proposal_id" UUID,
    "evidence" JSONB,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_identities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "platform" "ChatPlatform" NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "username" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_link_codes" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_agent_memories_organization_id_agent_id_created_at_idx" ON "ai_agent_memories"("organization_id", "agent_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_identities_membership_id_idx" ON "chat_identities"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_identities_organization_id_platform_external_user_id_key" ON "chat_identities"("organization_id", "platform", "external_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_link_codes_code_hash_key" ON "chat_link_codes"("code_hash");

-- AddForeignKey
ALTER TABLE "ai_agent_memories" ADD CONSTRAINT "ai_agent_memories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_memories" ADD CONSTRAINT "ai_agent_memories_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_identities" ADD CONSTRAINT "chat_identities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_identities" ADD CONSTRAINT "chat_identities_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_link_codes" ADD CONSTRAINT "chat_link_codes_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

