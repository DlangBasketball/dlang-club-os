import type { MessagingRole } from "./permissions";

/** Which app a person reads messages in: office, coach app or parent app. */
export type MessagingApp = "admin" | "coach" | "parent";

export function appFor(roles: readonly MessagingRole[]): MessagingApp {
  if (roles.includes("admin") || roles.includes("finance")) return "admin";
  if (roles.includes("coach")) return "coach";
  return "parent";
}

export const MESSAGES_BASE: Record<MessagingApp, string> = {
  admin: "/admin/messages",
  coach: "/coach/messages",
  parent: "/parent/messages",
};

export function threadPath(app: MessagingApp, conversationId: string): string {
  return `${MESSAGES_BASE[app]}/${conversationId}`;
}

/** Home page of each app (where the alert banner links to). */
export const APP_HOME: Record<MessagingApp, string> = { admin: "/admin/dashboard", coach: "/coach", parent: "/parent/home" };
