# Roadmap Execution Plan: Artifacts & Enforced Outcomes

Date: 2026-05-17
Status: Execution-ready planning document for mergeable issue slicing

## Goal

Turn open roadmap themes into small, mergeable delivery slices while preserving V1 control-plane boundaries from `doc/SPEC-implementation.md`.

## Working Agreements

1. Coordinate core roadmap work in Discord `#dev` before implementation.
2. For each roadmap theme, document: Problem, Scope, Non-goals, Acceptance criteria.
3. Prefer plugin/reference implementations for extension surfaces.
4. Change core only when control-plane invariants require it.
5. Ship in vertical slices:
   - Slice 1: minimal data model/API
   - Slice 2: visible UI flow
   - Slice 3: governance/approvals/budget audit integration
   - Slice 4: docs/examples/tests

## Priority Order (from roadmap)

1. Artifacts & Work Products
2. Enforced Outcomes
3. Deep Planning
4. Cloud / Sandbox agents
5. Work Queues
6. Memory / Knowledge
7. Cloud deployments
8. CEO Chat
9. Automatic Organizational Learning
10. Self-Organization
11. Desktop App
12. MAXIMIZER MODE (cross-cutting program)

## Definition of Done (per theme)

- Matches `doc/SPEC-implementation.md` boundaries and invariants
- Contracts stay synced across db/shared/server/ui when behavior changes
- Relevant tests/build/typecheck pass
- PR body follows `.github/PULL_REQUEST_TEMPLATE.md` fully

---

## Theme A: Artifacts & Work Products

### Problem

Paperclip work completion is still overly transcript-centric. Operators need first-class outputs (documents, files, previews, links) attached to work objects.

### Scope

Create an artifact read/write path tied to issues/runs/comments and expose artifact-first UI surfaces.

### Non-goals

- Full DAM/CMS system
- Replacing existing issue/comment model
- General-purpose external file manager

### Acceptance Criteria

- Operators can see and open artifacts directly from issue/run context.
- Artifacts have clear ownership (company + work object linkage).
- Artifact actions are auditable in activity logs.
- Completion flows can point to concrete outputs.

### Epic A1 — Artifact Inventory Backbone (Core)

1. **A1.1 Schema + shared contracts for artifact metadata**
   - Add canonical artifact metadata model and linkage fields to work objects.
   - Keep company-scoping and ownership invariants explicit.
2. **A1.2 API endpoints for listing and fetching artifacts by work context**
   - Add issue/run/project-scoped artifact listing and detail retrieval.
3. **A1.3 Server write path for artifact registration from executions**
   - Register outputs generated during runs with stable references.
4. **A1.4 Activity/audit entries for artifact lifecycle events**
   - Log create/link/publish-like transitions.
5. **A1.5 Migration + compatibility pass**
   - Backfill or map existing attachment-style records to inventory shape.

### Epic A2 — Artifact-first UX (UI)

1. **A2.1 Issue detail: artifact panel with grouped work products**
2. **A2.2 Run detail: summary-first artifact section above raw logs**
3. **A2.3 Artifact preview routing for common text/image/link outputs**
4. **A2.4 Artifact filters (type/source/date) for operator triage**
5. **A2.5 Empty/error states with actionable guidance**

### Epic A3 — Governance + quality layer

1. **A3.1 Approval-aware artifact flags**
   - Mark artifacts awaiting approval vs approved outcomes where applicable.
2. **A3.2 Budget/cost attribution hooks for artifact-producing runs**
3. **A3.3 Tests for end-to-end artifact visibility and auditability**
4. **A3.4 Docs update**
   - Update roadmap-adjacent docs and operational usage guidance.

---

## Theme B: Enforced Outcomes

### Problem

Tasks can finish with ambiguous states. Paperclip needs stricter completion semantics tied to verifiable outcomes.

### Scope

Define and enforce explicit outcome records for issue completion and approval paths.

### Non-goals

- Fully automatic validation for every external system
- Replacing human review for high-risk actions
- Introducing a generic chatbot outcome model

### Acceptance Criteria

- Issues marked done include an explicit outcome classification.
- Outcome evidence is visible, auditable, and company-scoped.
- Approval flows can gate outcome finalization where required.
- Operators can quickly identify done-without-evidence drift.

### Epic B1 — Outcome model + server enforcement (Core)

1. **B1.1 Define outcome taxonomy**
   - Example classes: merged_code, published_artifact, shipped_docs, explicit_decision.
2. **B1.2 Add outcome payload contracts and persistence fields**
   - Keep db/shared/server aligned.
3. **B1.3 Enforce outcome requirement for done transitions**
   - Reject ambiguous completion attempts with actionable errors.
4. **B1.4 Add outcome verification state**
   - Distinguish declared vs verified outcomes when external proof is needed.
5. **B1.5 Add audit events for outcome creation/verification**

### Epic B2 — Outcome UX + review flow

1. **B2.1 Issue completion UI requires selecting/providing an outcome**
2. **B2.2 Outcome evidence card on issue/run detail**
3. **B2.3 Approval UI integration for outcome-gated actions**
4. **B2.4 “Needs evidence” operational views/filters**

### Epic B3 — Rollout and safeguards

1. **B3.1 Backward-compatible rollout policy**
   - Existing issues remain readable; enforcement applies to new transitions.
2. **B3.2 Metrics/logging for rejected completion attempts**
3. **B3.3 Tests covering transition guards, approvals, and regressions**
4. **B3.4 Docs update**
   - Clarify completion semantics for operators and contributors.

---

## Suggested First Implementation Sequence

1. A1.1 → A1.2 → A2.1
2. B1.1 → B1.2 → B1.3
3. A2.2 + B2.1
4. A3.3 + B3.3
5. Documentation updates and release notes

This sequence produces visible operator value quickly while reducing risk from broad schema/UI changes.
