import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  addApprovalCommentSchema,
  agentResolveApprovalSchema,
  createApprovalSchema,
  requestApprovalRevisionSchema,
  resolveApprovalSchema,
  resubmitApprovalSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  approvalService,
  heartbeatService,
  issueApprovalService,
  logActivity,
  secretService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { redactEventPayload } from "../redaction.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

function redactApprovalPayload<T extends { payload: Record<string, unknown> }>(approval: T): T {
  return {
    ...approval,
    payload: redactEventPayload(approval.payload) ?? {},
  };
}

export function approvalRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const svc = approvalService(db);
  const heartbeat = heartbeatService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const issueApprovalsSvc = issueApprovalService(db);
  const secretsSvc = secretService(db);
  const strictSecretsMode = process.env.PAPERCLIP_SECRETS_STRICT_MODE === "true";

  async function requireApprovalAccess(req: Request, id: string) {
    const approval = await svc.getById(id);
    if (!approval) {
      return null;
    }
    assertCompanyAccess(req, approval.companyId);
    return approval;
  }

  router.get("/companies/:companyId/approvals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const status = req.query.status as string | undefined;
    const result = await svc.list(companyId, status);
    res.json(result.map((approval) => redactApprovalPayload(approval)));
  });

  router.get("/approvals/:id", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    res.json(redactApprovalPayload(approval));
  });

  router.post("/companies/:companyId/approvals", validate(createApprovalSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rawIssueIds = req.body.issueIds;
    const issueIds = Array.isArray(rawIssueIds)
      ? rawIssueIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const uniqueIssueIds = Array.from(new Set(issueIds));
    const { issueIds: _issueIds, ...approvalInput } = req.body;
    const normalizedPayload =
      approvalInput.type === "hire_agent"
        ? await secretsSvc.normalizeHireApprovalPayloadForPersistence(
            companyId,
            approvalInput.payload,
            { strictMode: strictSecretsMode },
          )
        : approvalInput.payload;

    // For qa_review approvals, extract the designated reviewer agent from the payload
    const reviewerAgentId =
      approvalInput.type === "qa_review" &&
      typeof (normalizedPayload as Record<string, unknown>)?.reviewerAgentId === "string"
        ? ((normalizedPayload as Record<string, unknown>).reviewerAgentId as string)
        : null;

    const actor = getActorInfo(req);
    const approval = await svc.create(companyId, {
      ...approvalInput,
      payload: normalizedPayload,
      reviewerAgentId,
      requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
      requestedByAgentId:
        approvalInput.requestedByAgentId ?? (actor.actorType === "agent" ? actor.actorId : null),
      status: "pending",
      decisionNote: null,
      decidedByUserId: null,
      decidedByAgentId: null,
      decidedAt: null,
      updatedAt: new Date(),
    });

    if (uniqueIssueIds.length > 0) {
      await issueApprovalsSvc.linkManyForApproval(approval.id, uniqueIssueIds, {
        agentId: actor.agentId,
        userId: actor.actorType === "user" ? actor.actorId : null,
      });
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.created",
      entityType: "approval",
      entityId: approval.id,
      details: { type: approval.type, issueIds: uniqueIssueIds, reviewerAgentId },
    });

    // For qa_review: wake up the designated reviewer agent immediately
    if (approval.type === "qa_review" && reviewerAgentId) {
      const linkedIssueIds = uniqueIssueIds;
      const primaryIssueId = linkedIssueIds[0] ?? null;
      try {
        await heartbeat.wakeup(reviewerAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "qa_review_requested",
          payload: {
            approvalId: approval.id,
            approvalType: "qa_review",
            requestedByAgentId: approval.requestedByAgentId,
            issueId: primaryIssueId,
            issueIds: linkedIssueIds,
          },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: {
            source: "approval.qa_review_requested",
            approvalId: approval.id,
            issueId: primaryIssueId,
            issueIds: linkedIssueIds,
            wakeReason: "qa_review_requested",
          },
        });
      } catch (err) {
        logger.warn(
          { err, approvalId: approval.id, reviewerAgentId },
          "failed to wake reviewer agent after qa_review approval creation",
        );
      }
    }

    res.status(201).json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/issues", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const issues = await issueApprovalsSvc.listIssuesForApproval(id);
    res.json(issues);
  });

  router.post("/approvals/:id/approve", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!(await requireApprovalAccess(req, id))) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    const decidedByUserId = req.actor.userId ?? "board";
    const { approval, applied } = await svc.approve(id, decidedByUserId, req.body.decisionNote);

    if (applied) {
      const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(approval.id);
      const linkedIssueIds = linkedIssues.map((issue) => issue.id);
      const primaryIssueId = linkedIssueIds[0] ?? null;

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.approved",
        entityType: "approval",
        entityId: approval.id,
        details: {
          type: approval.type,
          requestedByAgentId: approval.requestedByAgentId,
          linkedIssueIds,
        },
      });

      if (approval.requestedByAgentId) {
        try {
          const wakeRun = await heartbeat.wakeup(approval.requestedByAgentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "approval_approved",
            payload: {
              approvalId: approval.id,
              approvalStatus: approval.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
            },
            requestedByActorType: "user",
            requestedByActorId: req.actor.userId ?? "board",
            contextSnapshot: {
              source: "approval.approved",
              approvalId: approval.id,
              approvalStatus: approval.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
              taskId: primaryIssueId,
              wakeReason: "approval_approved",
            },
          });

          await logActivity(db, {
            companyId: approval.companyId,
            actorType: "user",
            actorId: req.actor.userId ?? "board",
            action: "approval.requester_wakeup_queued",
            entityType: "approval",
            entityId: approval.id,
            details: {
              requesterAgentId: approval.requestedByAgentId,
              wakeRunId: wakeRun?.id ?? null,
              linkedIssueIds,
            },
          });
        } catch (err) {
          logger.warn(
            {
              err,
              approvalId: approval.id,
              requestedByAgentId: approval.requestedByAgentId,
            },
            "failed to queue requester wakeup after approval",
          );
          await logActivity(db, {
            companyId: approval.companyId,
            actorType: "user",
            actorId: req.actor.userId ?? "board",
            action: "approval.requester_wakeup_failed",
            entityType: "approval",
            entityId: approval.id,
            details: {
              requesterAgentId: approval.requestedByAgentId,
              linkedIssueIds,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    }

    res.json(redactApprovalPayload(approval));
  });

  router.post("/approvals/:id/reject", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!(await requireApprovalAccess(req, id))) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    const decidedByUserId = req.actor.userId ?? "board";
    const { approval, applied } = await svc.reject(id, decidedByUserId, req.body.decisionNote);

    if (applied) {
      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.rejected",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });
    }

    res.json(redactApprovalPayload(approval));
  });

  router.post(
    "/approvals/:id/request-revision",
    validate(requestApprovalRevisionSchema),
    async (req, res) => {
      assertBoard(req);
      const id = req.params.id as string;
      if (!(await requireApprovalAccess(req, id))) {
        res.status(404).json({ error: "Approval not found" });
        return;
      }
      const decidedByUserId = req.actor.userId ?? "board";
      const approval = await svc.requestRevision(id, decidedByUserId, req.body.decisionNote);

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.revision_requested",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });

      res.json(redactApprovalPayload(approval));
    },
  );

  router.post("/approvals/:id/resubmit", validate(resubmitApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    if (req.actor.type === "agent" && req.actor.agentId !== existing.requestedByAgentId) {
      res.status(403).json({ error: "Only requesting agent can resubmit this approval" });
      return;
    }

    const normalizedPayload = req.body.payload
      ? existing.type === "hire_agent"
        ? await secretsSvc.normalizeHireApprovalPayloadForPersistence(
            existing.companyId,
            req.body.payload,
            { strictMode: strictSecretsMode },
          )
        : req.body.payload
      : undefined;
    const approval = await svc.resubmit(id, normalizedPayload);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.resubmitted",
      entityType: "approval",
      entityId: approval.id,
      details: { type: approval.type },
    });
    res.json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/comments", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const comments = await svc.listComments(id);
    res.json(comments);
  });

  router.post("/approvals/:id/comments", validate(addApprovalCommentSchema), async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const actor = getActorInfo(req);
    const comment = await svc.addComment(id, req.body.body, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
    });

    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.comment_added",
      entityType: "approval",
      entityId: approval.id,
      details: { commentId: comment.id },
    });

    res.status(201).json(comment);
  });

  /**
   * Agent-initiated approval for qa_review approvals.
   * Only the designated reviewer agent (reviewerAgentId) may call this endpoint.
   */
  router.post("/approvals/:id/agent-approve", validate(agentResolveApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);

    if (approval.type !== "qa_review") {
      res.status(422).json({ error: "Only qa_review approvals can be resolved by an agent" });
      return;
    }

    const actorAgentId = req.actor.type === "agent" ? req.actor.agentId : null;
    if (!actorAgentId) {
      res.status(403).json({ error: "Agent authentication required" });
      return;
    }
    if (approval.reviewerAgentId !== actorAgentId) {
      res.status(403).json({ error: "Only the designated reviewer agent may approve this request" });
      return;
    }

    const { approval: updated, applied } = await svc.approveByAgent(id, actorAgentId, req.body.decisionNote);

    if (applied) {
      const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(updated.id);
      const linkedIssueIds = linkedIssues.map((issue) => issue.id);
      const primaryIssueId = linkedIssueIds[0] ?? null;

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: updated.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "approval.agent_approved",
        entityType: "approval",
        entityId: updated.id,
        details: {
          type: updated.type,
          reviewerAgentId: actorAgentId,
          requestedByAgentId: updated.requestedByAgentId,
          linkedIssueIds,
        },
      });

      // Wake the requesting agent to notify them of the QA decision
      if (updated.requestedByAgentId) {
        try {
          await heartbeat.wakeup(updated.requestedByAgentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "qa_review_approved",
            payload: {
              approvalId: updated.id,
              approvalStatus: updated.status,
              reviewerAgentId: actorAgentId,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
            },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              source: "approval.qa_review_approved",
              approvalId: updated.id,
              approvalStatus: updated.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
              wakeReason: "qa_review_approved",
            },
          });
        } catch (err) {
          logger.warn(
            { err, approvalId: updated.id, requestedByAgentId: updated.requestedByAgentId },
            "failed to wake requester agent after qa_review approval",
          );
        }
      }
    }

    res.json(redactApprovalPayload(updated));
  });

  /**
   * Agent-initiated rejection for qa_review approvals.
   * Only the designated reviewer agent (reviewerAgentId) may call this endpoint.
   */
  router.post("/approvals/:id/agent-reject", validate(agentResolveApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);

    if (approval.type !== "qa_review") {
      res.status(422).json({ error: "Only qa_review approvals can be resolved by an agent" });
      return;
    }

    const actorAgentId = req.actor.type === "agent" ? req.actor.agentId : null;
    if (!actorAgentId) {
      res.status(403).json({ error: "Agent authentication required" });
      return;
    }
    if (approval.reviewerAgentId !== actorAgentId) {
      res.status(403).json({ error: "Only the designated reviewer agent may reject this request" });
      return;
    }

    const { approval: updated, applied } = await svc.rejectByAgent(id, actorAgentId, req.body.decisionNote);

    if (applied) {
      const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(updated.id);
      const linkedIssueIds = linkedIssues.map((issue) => issue.id);
      const primaryIssueId = linkedIssueIds[0] ?? null;

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: updated.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "approval.agent_rejected",
        entityType: "approval",
        entityId: updated.id,
        details: {
          type: updated.type,
          reviewerAgentId: actorAgentId,
          requestedByAgentId: updated.requestedByAgentId,
          linkedIssueIds,
        },
      });

      // Wake the requesting agent to notify them of the QA decision
      if (updated.requestedByAgentId) {
        try {
          await heartbeat.wakeup(updated.requestedByAgentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "qa_review_rejected",
            payload: {
              approvalId: updated.id,
              approvalStatus: updated.status,
              reviewerAgentId: actorAgentId,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
            },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              source: "approval.qa_review_rejected",
              approvalId: updated.id,
              approvalStatus: updated.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
              wakeReason: "qa_review_rejected",
            },
          });
        } catch (err) {
          logger.warn(
            { err, approvalId: updated.id, requestedByAgentId: updated.requestedByAgentId },
            "failed to wake requester agent after qa_review rejection",
          );
        }
      }
    }

    res.json(redactApprovalPayload(updated));
  });

  return router;
}
