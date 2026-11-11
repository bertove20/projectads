-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('SUPERVISOR', 'WORKER');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('PROFIT', 'ROI', 'REVENUE', 'CONVERSIONS', 'CPA', 'SPEND');

-- CreateEnum
CREATE TYPE "GoalPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('MEETING', 'DIRECTIVE');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiRunMessageKind" AS ENUM ('DIRECTIVE', 'PLAN', 'ASSIGNMENT', 'REPORT', 'DISCUSSION', 'SUMMARY', 'TOOL', 'NOTE', 'ERROR');

-- CreateEnum
CREATE TYPE "ProposalAction" AS ENUM ('CREATE_TASK', 'CAMPAIGN_STATUS', 'ZONE_LIST');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SUPERVISOR_REJECTED', 'PENDING_OWNER', 'APPROVED', 'REJECTED', 'REVISION', 'EXECUTED', 'FAILED');

-- AlterTable
ALTER TABLE "ai_usage_logs" ADD COLUMN     "agent_id" UUID,
ADD COLUMN     "run_id" UUID;

-- CreateTable
CREATE TABLE "ai_team_settings" (
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_at" TIMESTAMP(3),
    "paused_by_id" UUID,
    "meeting_enabled" BOOLEAN NOT NULL DEFAULT true,
    "meeting_time" TEXT NOT NULL DEFAULT '09:00',
    "daily_budget_usd" DECIMAL(12,4),
    "run_budget_usd" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_team_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "role" "AgentRole" NOT NULL,
    "position" "Position",
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "model_id" UUID,
    "instructions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "target" DECIMAL(18,6) NOT NULL,
    "period" "GoalPeriod" NOT NULL,
    "campaign_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "AiRunKind" NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'QUEUED',
    "title" TEXT NOT NULL,
    "directive" TEXT,
    "requested_by_id" UUID,
    "meeting_date" TEXT,
    "stage" TEXT,
    "summary" TEXT,
    "brief" JSONB,
    "cost_usd" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_run_messages" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "agent_id" UUID,
    "author_id" UUID,
    "kind" "AiRunMessageKind" NOT NULL,
    "stage" TEXT,
    "content" TEXT NOT NULL,
    "data" JSONB,
    "tool_name" TEXT,
    "evidence_id" TEXT,
    "model_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_run_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proposals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "action" "ProposalAction" NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "campaign_id" UUID,
    "risk" TEXT NOT NULL DEFAULT 'MEDIUM',
    "expected_impact" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "discussion" JSONB,
    "supervisor_note" TEXT,
    "owner_note" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_organization_id_key_key" ON "ai_agents"("organization_id", "key");

-- CreateIndex
CREATE INDEX "ai_goals_organization_id_active_idx" ON "ai_goals"("organization_id", "active");

-- CreateIndex
CREATE INDEX "ai_runs_organization_id_created_at_idx" ON "ai_runs"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_runs_organization_id_kind_meeting_date_key" ON "ai_runs"("organization_id", "kind", "meeting_date");

-- CreateIndex
CREATE INDEX "ai_run_messages_run_id_created_at_idx" ON "ai_run_messages"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_proposals_organization_id_status_idx" ON "ai_proposals"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_proposals_run_id_ref_key" ON "ai_proposals"("run_id", "ref");

-- CreateIndex
CREATE INDEX "ai_usage_logs_agent_id_created_at_idx" ON "ai_usage_logs"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_run_id_idx" ON "ai_usage_logs"("run_id");

-- AddForeignKey
ALTER TABLE "ai_team_settings" ADD CONSTRAINT "ai_team_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_goals" ADD CONSTRAINT "ai_goals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_goals" ADD CONSTRAINT "ai_goals_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run_messages" ADD CONSTRAINT "ai_run_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run_messages" ADD CONSTRAINT "ai_run_messages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

