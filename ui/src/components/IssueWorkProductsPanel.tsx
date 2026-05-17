import { useQuery } from "@tanstack/react-query";
import type { IssueWorkProduct } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";
import {
  ExternalLink,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  Package,
  Server,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Type icons                                                                  */
/* -------------------------------------------------------------------------- */

function WorkProductIcon({ type }: { type: string }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  switch (type) {
    case "pull_request":
      return <GitPullRequest className={cls} />;
    case "branch":
      return <GitBranch className={cls} />;
    case "commit":
      return <GitCommit className={cls} />;
    case "preview_url":
      return <Globe className={cls} />;
    case "artifact":
      return <Package className={cls} />;
    case "document":
      return <FileText className={cls} />;
    case "runtime_service":
      return <Server className={cls} />;
    default:
      return <Package className={cls} />;
  }
}

/* -------------------------------------------------------------------------- */
/*  Work product status badge                                                   */
/* -------------------------------------------------------------------------- */

const workProductStatusBadge: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  ready_for_review: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  changes_requested: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  merged: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
  closed: "bg-muted text-muted-foreground",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  archived: "bg-muted text-muted-foreground",
  draft: "bg-muted text-muted-foreground",
};

function WorkProductStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0",
        workProductStatusBadge[status] ?? statusBadgeDefault,
        statusBadge[status],
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Single work product row                                                     */
/* -------------------------------------------------------------------------- */

function WorkProductRow({ wp }: { wp: IssueWorkProduct }) {
  const content = (
    <div className="flex items-center gap-2 min-w-0">
      <WorkProductIcon type={wp.type} />
      <span className="text-xs truncate flex-1 min-w-0">{wp.title}</span>
      <WorkProductStatusBadge status={wp.status} />
      {wp.url && (
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
    </div>
  );

  if (wp.url) {
    return (
      <a
        href={wp.url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-md border border-border px-2.5 py-1.5 hover:bg-accent/50 transition-colors"
        title={wp.url}
      >
        {content}
      </a>
    );
  }

  return (
    <div className="rounded-md border border-border px-2.5 py-1.5">
      {content}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Type group label                                                            */
/* -------------------------------------------------------------------------- */

const TYPE_LABEL: Record<string, string> = {
  pull_request: "Pull Requests",
  branch: "Branches",
  commit: "Commits",
  preview_url: "Preview URLs",
  artifact: "Artifacts",
  document: "Documents",
  runtime_service: "Runtime Services",
};

/* -------------------------------------------------------------------------- */
/*  Panel                                                                       */
/* -------------------------------------------------------------------------- */

interface IssueWorkProductsPanelProps {
  issueId: string;
}

export function IssueWorkProductsPanel({ issueId }: IssueWorkProductsPanelProps) {
  const { data: workProducts = [], isLoading } = useQuery({
    queryKey: queryKeys.issues.workProducts(issueId),
    queryFn: () => issuesApi.listWorkProducts(issueId),
    staleTime: 30_000,
  });

  if (isLoading) return null;
  if (workProducts.length === 0) return null;

  // Group by type, primary items first within each group
  const byType = new Map<string, IssueWorkProduct[]>();
  for (const wp of workProducts) {
    const existing = byType.get(wp.type) ?? [];
    byType.set(wp.type, [...existing, wp]);
  }

  // Sort: primary items first within each group
  for (const [type, items] of byType) {
    byType.set(type, [...items].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)));
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">Work Products</h3>
      <div className="space-y-3">
        {[...byType.entries()].map(([type, items]) => (
          <div key={type} className="space-y-1.5">
            {byType.size > 1 && (
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {TYPE_LABEL[type] ?? type.replace(/_/g, " ")}
              </p>
            )}
            {items.map((wp) => (
              <WorkProductRow key={wp.id} wp={wp} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
