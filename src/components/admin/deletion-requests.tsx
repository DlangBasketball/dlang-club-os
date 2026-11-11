"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardBody, Button, Badge } from "@/components/ui";
import { processDeletionRequest } from "@/lib/actions/privacy";
import type { DeletionRequest } from "@/lib/data/privacy";
import { formatDate } from "@/lib/utils";

const TONE: Record<string, "warning" | "success" | "danger" | "neutral"> = { pending: "warning", completed: "success", rejected: "danger" };

export function DeletionRequests({ requests }: { requests: DeletionRequest[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  async function act(id: string, approve: boolean) {
    if (approve && !confirm("Approve erasure? This anonymises the family's personal data. Financial records are retained. This cannot be undone.")) return;
    setBusy(id); await processDeletionRequest(id, approve); setBusy(null); router.refresh();
  }
  return (
    <Card>
      <CardHeader><CardTitle>Deletion requests</CardTitle></CardHeader>
      <CardBody className="p-0">
        {requests.length === 0 ? (
          <div className="p-5 text-sm text-ink-3">No deletion requests.</div>
        ) : (
          <ul>{requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
              <div className="min-w-0"><div className="truncate text-sm text-ink">{r.familyName}</div><div className="truncate text-xs text-ink-3">by {r.requestedBy} · {formatDate(r.createdAt)}{r.reason ? ` · ${r.reason}` : ""}</div></div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                {r.status === "pending" && (
                  <>
                    <Button size="sm" variant="danger" onClick={() => act(r.id, true)} disabled={busy !== null}>{busy === r.id ? "…" : "Approve"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(r.id, false)} disabled={busy !== null}>Reject</Button>
                  </>
                )}
              </div>
            </li>
          ))}</ul>
        )}
      </CardBody>
    </Card>
  );
}
