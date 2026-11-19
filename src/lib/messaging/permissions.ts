/**
 * Who may message whom — the TypeScript mirror of public.msg_can_contact(),
 * msg_can_read() and msg_can_post() (migration 20250420100700). The database
 * is the authority (RLS + RPCs); this copy drives the UI (which contacts to
 * offer, whether to show a composer) and is unit-tested against the same
 * matrix as tests/db/messaging.sql.
 *
 *   admin / finance (office) -> any staff member or guardian of the club
 *   coach                    -> any staff member; guardians of athletes they coach
 *   guardian                 -> the office; coaches of their own children;
 *                               never another guardian (contact confidentiality)
 *
 * Athletes have no messaging identity: messages about a child go through the
 * child's guardians (safeguarding: no private adult <-> minor threads).
 */

export type MessagingRole = "admin" | "finance" | "coach" | "parent";

export type Party = {
  id: string;
  orgId: string;
  roles: readonly MessagingRole[];
  active?: boolean;
  /** Families this person is a guardian of. */
  familyIds?: readonly string[];
  /** Coaches: families whose athletes they coach (programme, team, booking). */
  servedFamilyIds?: readonly string[];
};

const isOffice = (p: Party) => p.roles.includes("admin") || p.roles.includes("finance");
const isStaff = (p: Party) => isOffice(p) || p.roles.includes("coach");
const isGuardian = (p: Party) => (p.familyIds?.length ?? 0) > 0 || p.roles.includes("parent");

/** May `sender` start a direct thread with `target`? */
export function canMessage(sender: Party, target: Party): boolean {
  if (sender.id === target.id || sender.orgId !== target.orgId) return false;
  if (target.active === false || sender.active === false) return false;
  if (!isStaff(target) && !isGuardian(target)) return false;
  if (isOffice(sender)) return true;
  if (isStaff(sender)) {
    if (isStaff(target)) return true;
    const served = new Set(sender.servedFamilyIds ?? []);
    return (target.familyIds ?? []).some((f) => served.has(f));
  }
  if (isGuardian(sender)) {
    if (isOffice(target)) return true;
    if (isStaff(target)) {
      const served = new Set(target.servedFamilyIds ?? []);
      return (sender.familyIds ?? []).some((f) => served.has(f));
    }
  }
  return false;
}

/** May this person write to the club office (a thread without a named recipient)? */
export function canWriteToOffice(sender: Party, parentsCanStart: boolean): boolean {
  return !isStaff(sender) && isGuardian(sender) && parentsCanStart;
}

export type ThreadFacts = {
  sameOrg: boolean;
  kind: "direct" | "channel";
  status: "open" | "closed";
  office: boolean;
  allowReplies: boolean;
  /** Club setting: parents may reply in channels. */
  parentRepliesEnabled: boolean;
  /** Viewer is an explicit participant (direct threads). */
  isParticipant: boolean;
  /** Viewer coaches the channel's team / programme / camp edition. */
  isScopeStaff: boolean;
  /** Viewer guards an athlete in the channel's scope. */
  isScopeGuardian: boolean;
};

export type ThreadAccess = { read: boolean; post: boolean; member: boolean; moderate: boolean };

/** Read / post / membership for a viewer (mirror of the SQL access functions). */
export function threadAccess(roles: readonly MessagingRole[], t: ThreadFacts): ThreadAccess {
  const none = { read: false, post: false, member: false, moderate: false };
  if (!t.sameOrg) return none;
  const admin = roles.includes("admin");
  const office = admin || roles.includes("finance");
  const member =
    t.kind === "direct"
      ? t.isParticipant || (t.office && office)
      : admin || t.isScopeStaff || t.isScopeGuardian;
  const read = admin || member;
  let post = false;
  if (read && t.status === "open") {
    post =
      t.kind === "direct" ||
      admin ||
      t.isScopeStaff ||
      (t.allowReplies && t.parentRepliesEnabled && t.isScopeGuardian);
  }
  return { read, post, member, moderate: admin };
}

/** Staff side of the board (coach, finance, admin) vs family side. */
export function sideOf(roles: readonly MessagingRole[]): "staff" | "family" {
  return roles.some((r) => r !== "parent") ? "staff" : "family";
}
