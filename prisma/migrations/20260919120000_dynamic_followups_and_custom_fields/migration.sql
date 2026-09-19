-- AlterEnum: extend the follow-up chain from 2 steps to up to 5, additive/non-destructive.
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_3';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_4';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_5';

-- AlterTable: per-campaign delay (hours after previous step) for the extra follow-up steps.
-- NULL means "this step is not enabled for this campaign".
ALTER TABLE "campaigns" ADD COLUMN "followup_3_delay_hours" INTEGER;
ALTER TABLE "campaigns" ADD COLUMN "followup_4_delay_hours" INTEGER;
ALTER TABLE "campaigns" ADD COLUMN "followup_5_delay_hours" INTEGER;

-- AlterTable: free-form variables captured from CSV columns that aren't first-class
-- contact fields (e.g. "Google Reviews Text"), usable as {{variable_name}} in templates.
ALTER TABLE "contacts" ADD COLUMN "custom_fields" JSONB;
