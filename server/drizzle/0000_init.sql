CREATE TYPE "public"."conversation_mode" AS ENUM('cross', 'same');--> statement-breakpoint
CREATE TYPE "public"."response_status" AS ENUM('streaming', 'complete', 'stopped', 'error');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"mode" "conversation_mode" NOT NULL,
	"system_prompt" text,
	"current_leaf_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lanes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	CONSTRAINT "lanes_conversation_position_uq" UNIQUE("conversation_id","position")
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL,
	"status" "response_status" DEFAULT 'streaming' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"message_json" jsonb,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "responses_turn_lane_uq" UNIQUE("turn_id","lane_id")
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"parent_turn_id" uuid,
	"focus_lane_id" uuid,
	"user_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_lane_id_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."lanes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_parent_turn_id_turns_id_fk" FOREIGN KEY ("parent_turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_focus_lane_id_lanes_id_fk" FOREIGN KEY ("focus_lane_id") REFERENCES "public"."lanes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "responses_lane_idx" ON "responses" USING btree ("lane_id");--> statement-breakpoint
CREATE INDEX "turns_conversation_idx" ON "turns" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "turns_parent_idx" ON "turns" USING btree ("parent_turn_id");