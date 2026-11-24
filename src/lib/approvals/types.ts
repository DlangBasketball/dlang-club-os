import { nextStep, type NextStep } from "@/lib/status/next-step";
import type { ClubRequestKind, ClubRequestStatus } from "./db";

/**
 * One club approval request as returned by club_request_queue() /
 * club_request_family_list() (public.club_request_row). Contact fields are
 * null for coaches and families.
 */
export type ClubRequestMessage = { side: "family" | "club"; kind: string; body: string | null; at: string };
export type ClubRequest = {
  id: string;
  subject_kind: ClubRequestKind;
  status: ClubRequestStatus;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  program: { id: string; name: string; kind: string; price: number | string; currency: string; capacity: number | null; taken: number } | null;
  membership_type: { id: string; name: string; scope: "person" | "family"; price: number | string; currency: string } | null;
  athlete: { id: string; first_name: string; last_name: string; age: number | null } | null;
  family: { id: string; name: string | null; email: string | null; phone: string | null };
  requested_by: { name: string | null; email: string | null };
  assigned_coaches: string[];
  messages: ClubRequestMessage[];
  registration: { id: string; status: string; invoice_id: string | null } | null;
  membership: { id: string; status: string; invoice_id: string | null; valid_from: string; valid_until: string } | null;
  invoice: { id: string; number: string; status: string; currency: string; open: number | string | null } | null;
};

export function asRequests(data: unknown): ClubRequest[] {
  return Array.isArray(data) ? (data as ClubRequest[]) : [];
}

/** Family-facing next step of a request, derived from the request and its source rows. */
export function requestNextStep(r: Pick<ClubRequest, "status" | "registration" | "membership" | "invoice">): NextStep {
  const balance = r.invoice ? Number(r.invoice.open ?? 0) : null;
  if (r.status !== "approved") return nextStep({ clubApproval: r.status });
  const status = r.registration?.status ?? r.membership?.status ?? null;
  return nextStep({ clubApproval: "approved", status, balance });
}

/** Display name of the subject (programme or membership type). */
export function requestSubject(r: Pick<ClubRequest, "program" | "membership_type">): string {
  return r.program?.name ?? r.membership_type?.name ?? "";
}

export function requestChild(r: Pick<ClubRequest, "athlete" | "family">): string {
  return r.athlete ? `${r.athlete.first_name} ${r.athlete.last_name}`.trim() : r.family.name ?? "";
}
