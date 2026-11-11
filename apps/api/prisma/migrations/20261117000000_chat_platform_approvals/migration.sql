-- AlterTable
ALTER TABLE "ai_team_settings" ADD COLUMN     "chat_approvals" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chat_platform" "ChatPlatform" NOT NULL DEFAULT 'TELEGRAM';

