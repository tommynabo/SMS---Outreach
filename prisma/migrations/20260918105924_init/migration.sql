-- CreateEnum
CREATE TYPE "OutreachVariant" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('NEW', 'READY', 'QUEUED', 'ACTIVE', 'INITIAL_PENDING', 'INITIAL_SENT', 'FOLLOWUP_1_PENDING', 'FOLLOWUP_1_SENT', 'FOLLOWUP_2_PENDING', 'FOLLOWUP_2_SENT', 'COMPLETED', 'REPLIED', 'STOPPED', 'SEND_FAILED', 'PAUSED');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('NUEVO_PROSPECTO', 'SMS_ENVIADO', 'RESPONDIO', 'SEGUIMIENTO', 'REUNION_AGENDADA', 'GANADO', 'NO_INTERESADO');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('INITIAL', 'FOLLOWUP_1', 'FOLLOWUP_2');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'LOCKED', 'API_ACCEPTED', 'DISPATCHED', 'SENT', 'DELIVERED', 'FAILED', 'STALLED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('SYSTEM', 'TEXTBEE_MANUAL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_REPLY', 'OPT_OUT', 'SMS_FAILED', 'SMS_STALLED', 'CIRCUIT_BREAKER_OPEN', 'TEXTBEE_AUTH_ERROR', 'TEXTBEE_QUOTA_ERROR', 'UNKNOWN_INBOUND');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "company_name" TEXT,
    "phone_original" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "city" TEXT,
    "website" TEXT,
    "category" TEXT,
    "rating" DOUBLE PRECISION,
    "reviews_count" INTEGER,
    "about" TEXT,
    "review_sample" TEXT,
    "review_sample_rating" DOUBLE PRECISION,
    "source_query" TEXT,
    "maps_rank" INTEGER,
    "maps_url" TEXT,
    "place_id" TEXT,
    "address" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_variant" "OutreachVariant",
    "outreach_status" "OutreachStatus" NOT NULL DEFAULT 'NEW',
    "last_outbound_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "last_sms_reply" TEXT,
    "next_action_at" TIMESTAMP(3),
    "sequence_started_at" TIMESTAMP(3),
    "sequence_completed_at" TIMESTAMP(3),
    "do_not_contact_sms" BOOLEAN NOT NULL DEFAULT false,
    "needs_manual_reply" BOOLEAN NOT NULL DEFAULT false,
    "opted_out_at" TIMESTAMP(3),
    "opt_out_message" TEXT,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "send_window_start" TEXT NOT NULL DEFAULT '08:45',
    "send_window_end" TEXT NOT NULL DEFAULT '18:45',
    "allowed_weekdays" TEXT NOT NULL DEFAULT 'MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY',
    "minimum_send_gap_seconds" INTEGER NOT NULL DEFAULT 600,
    "max_sms_per_day" INTEGER NOT NULL DEFAULT 60,
    "followup_1_delay_hours" INTEGER NOT NULL DEFAULT 48,
    "followup_2_delay_hours" INTEGER NOT NULL DEFAULT 96,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_entries" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL DEFAULT 'NUEVO_PROSPECTO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "action_type" "ActionType" NOT NULL,
    "variant" "OutreachVariant" NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_actions" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "action_type" "ActionType" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "locked_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "textbee_sms_id" TEXT,
    "textbee_batch_id" TEXT,
    "rendered_message" TEXT NOT NULL,
    "api_response_json" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "outreach_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT,
    "campaign_id" TEXT,
    "outreach_action_id" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "source" "MessageSource" NOT NULL DEFAULT 'SYSTEM',
    "textbee_sms_id" TEXT,
    "textbee_batch_id" TEXT,
    "phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3),
    "api_accepted_at" TIMESTAMP(3),
    "dispatched_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload_json" JSONB NOT NULL,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmatched_inbound" (
    "id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unmatched_inbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "contact_id" TEXT,
    "campaign_id" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "details_json" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_runtime_state" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "global_paused" BOOLEAN NOT NULL DEFAULT false,
    "pause_reason" TEXT,
    "last_global_send_attempt_at" TIMESTAMP(3),
    "last_global_successful_send_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "consecutive_stalled" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_runtime_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_state" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "cursor" TEXT,
    "last_run_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_phone_e164_key" ON "contacts"("phone_e164");

-- CreateIndex
CREATE INDEX "contacts_outreach_status_idx" ON "contacts"("outreach_status");

-- CreateIndex
CREATE INDEX "contacts_do_not_contact_sms_idx" ON "contacts"("do_not_contact_sms");

-- CreateIndex
CREATE INDEX "contact_tags_tag_idx" ON "contact_tags"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "contact_tags_contact_id_tag_key" ON "contact_tags"("contact_id", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_entries_contact_id_campaign_id_key" ON "pipeline_entries"("contact_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_action_type_variant_key" ON "message_templates"("action_type", "variant");

-- CreateIndex
CREATE INDEX "outreach_actions_status_scheduled_for_idx" ON "outreach_actions"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_actions_campaign_id_contact_id_action_type_key" ON "outreach_actions"("campaign_id", "contact_id", "action_type");

-- CreateIndex
CREATE INDEX "sms_messages_direction_idx" ON "sms_messages"("direction");

-- CreateIndex
CREATE INDEX "sms_messages_phone_idx" ON "sms_messages"("phone");

-- CreateIndex
CREATE INDEX "sms_messages_textbee_sms_id_idx" ON "sms_messages"("textbee_sms_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_webhook_events_idempotency_key_key" ON "processed_webhook_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "audit_log_event_idx" ON "audit_log"("event");

-- CreateIndex
CREATE INDEX "audit_log_contact_id_idx" ON "audit_log"("contact_id");

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_entries" ADD CONSTRAINT "pipeline_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_entries" ADD CONSTRAINT "pipeline_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_outreach_action_id_fkey" FOREIGN KEY ("outreach_action_id") REFERENCES "outreach_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
