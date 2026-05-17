ALTER TABLE "approvals" ADD COLUMN "reviewer_agent_id" uuid REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "decided_by_agent_id" uuid REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
