import type { Translator } from "@/lib/i18n/translator";
import type { InboxRow } from "./db";

/** Title of a thread for lists: subject, else channel scope, office, people or family. */
export function threadTitle(t: Translator, i: Pick<InboxRow, "subject" | "kind" | "scope_name" | "office" | "family_name" | "people">): string {
  if (i.subject) return i.subject;
  if (i.kind === "channel") return i.scope_name ?? t("messaging.inbox.channel");
  if (i.office) return t("messaging.inbox.toOffice");
  return i.people || i.family_name || t("messaging.inbox.untitled");
}
