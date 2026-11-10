-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('OK', 'ERROR', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SkillRisk" AS ENUM ('READ_ONLY', 'DRAFT', 'WRITE');

-- CreateEnum
CREATE TYPE "SkillSource" AS ENUM ('BUILTIN', 'CUSTOM', 'IMPORTED');

-- CreateEnum
CREATE TYPE "SkillReview" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ai_settings" (
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "api_key_ciphertext" TEXT,
    "api_key_hint" TEXT,
    "api_key_validated_at" TIMESTAMP(3),
    "monthly_budget_usd" DECIMAL(12,4),
    "retention_days" INTEGER NOT NULL DEFAULT 90,
    "models_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "model_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "context_length" INTEGER,
    "max_completion_tokens" INTEGER,
    "prompt_price" DECIMAL(20,12) NOT NULL,
    "completion_price" DECIMAL(20,12) NOT NULL,
    "supports_tools" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "last_validated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_position_configs" (
    "organization_id" UUID NOT NULL,
    "position" "Position" NOT NULL,
    "model_id" UUID,
    "fallback_model_id" UUID,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "max_tokens" INTEGER NOT NULL DEFAULT 1200,
    "daily_budget_usd" DECIMAL(12,4),
    "monthly_budget_usd" DECIMAL(12,4),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_position_configs_pkey" PRIMARY KEY ("organization_id","position")
);

-- CreateTable
CREATE TABLE "ai_member_configs" (
    "membership_id" UUID NOT NULL,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
    "model_id" UUID,
    "fallback_model_id" UUID,
    "temperature" DOUBLE PRECISION,
    "max_tokens" INTEGER,
    "daily_budget_usd" DECIMAL(12,4),
    "monthly_budget_usd" DECIMAL(12,4),
    "max_requests_per_day" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_member_configs_pkey" PRIMARY KEY ("membership_id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "position" "Position" NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "tool_call_id" TEXT,
    "tool_name" TEXT,
    "skill_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID,
    "conversation_id" UUID,
    "position" "Position",
    "model_id" TEXT NOT NULL,
    "used_fallback" BOOLEAN NOT NULL DEFAULT false,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "status" "AiUsageStatus" NOT NULL,
    "error" TEXT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_skills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "positions" "Position"[],
    "risk_class" "SkillRisk" NOT NULL DEFAULT 'READ_ONLY',
    "tools" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" "SkillSource" NOT NULL DEFAULT 'CUSTOM',
    "active_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_skill_versions" (
    "id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "skill_md" TEXT NOT NULL,
    "test_cases" JSONB,
    "changelog" TEXT,
    "review" "SkillReview" NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_skill_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_skill_assignments" (
    "skill_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_skill_assignments_pkey" PRIMARY KEY ("skill_id","membership_id")
);

-- CreateTable
CREATE TABLE "ai_task_drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "campaign_id" UUID,
    "due_date" DATE,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "card_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "ai_task_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_organization_id_model_id_key" ON "ai_models"("organization_id", "model_id");

-- CreateIndex
CREATE INDEX "ai_conversations_membership_id_updated_at_idx" ON "ai_conversations"("membership_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_organization_id_created_at_idx" ON "ai_usage_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_membership_id_created_at_idx" ON "ai_usage_logs"("membership_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_skills_active_version_id_key" ON "ai_skills"("active_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_skills_organization_id_key_key" ON "ai_skills"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_skill_versions_skill_id_version_key" ON "ai_skill_versions"("skill_id", "version");

-- CreateIndex
CREATE INDEX "ai_task_drafts_membership_id_status_idx" ON "ai_task_drafts"("membership_id", "status");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_position_configs" ADD CONSTRAINT "ai_position_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_position_configs" ADD CONSTRAINT "ai_position_configs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_position_configs" ADD CONSTRAINT "ai_position_configs_fallback_model_id_fkey" FOREIGN KEY ("fallback_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_member_configs" ADD CONSTRAINT "ai_member_configs_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_member_configs" ADD CONSTRAINT "ai_member_configs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_member_configs" ADD CONSTRAINT "ai_member_configs_fallback_model_id_fkey" FOREIGN KEY ("fallback_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_skills" ADD CONSTRAINT "ai_skills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_skills" ADD CONSTRAINT "ai_skills_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "ai_skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_skill_versions" ADD CONSTRAINT "ai_skill_versions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "ai_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_skill_assignments" ADD CONSTRAINT "ai_skill_assignments_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "ai_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_skill_assignments" ADD CONSTRAINT "ai_skill_assignments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_task_drafts" ADD CONSTRAINT "ai_task_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

