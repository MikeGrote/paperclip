import type { ApprovalStatus, ApprovalType } from "../constants.js";

export interface Approval {
  id: string;
  companyId: string;
  type: ApprovalType;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  /** For qa_review approvals: the agent designated to review and decide */
  reviewerAgentId: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  /** Set when an agent (rather than a board user) resolves the approval */
  decidedByAgentId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalComment {
  id: string;
  companyId: string;
  approvalId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}
