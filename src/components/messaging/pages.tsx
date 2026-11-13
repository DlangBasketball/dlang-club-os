import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bell, MessageSquarePlus, Settings, ShieldAlert } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getContacts, getInbox, getMessagingSettings, getMyFamilies, getMyPreferences, getScopeOptions, getThread } from "@/lib/messaging/data";
import { MESSAGES_BASE, type MessagingApp } from "@/lib/messaging/paths";
import { canWriteToOffice, sideOf, type MessagingRole } from "@/lib/messaging/permissions";
import { effectiveChannels, type NotificationCategory } from "@/lib/messaging/preferences";
import { uuid } from "@/lib/messaging/validation";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "./auto-refresh";
import { InboxList } from "./inbox-list";
import { threadTitle } from "@/lib/messaging/format";
import { NewChannelForm, NewThreadForm } from "./compose-forms";
import { PreferencesForm } from "./settings";
import { ThreadView } from "./thread-view";

/**
 * Shared server pages of the message board for the three apps (office,
 * coach, parent). Every read goes through the signed-in user's RLS client.
 */

const ROLES: Record<MessagingApp, ("admin" | "finance" | "coach" | "parent")[]> = {
  admin: ["admin", "finance"],
  coach: ["coach", "admin"],
  parent: ["parent", "admin"],
};

export async function MessagesInboxPage({ app, view }: { app: MessagingApp; view?: string }) {
  const me = await requireRole(ROLES[app]);
  const { t } = await getI18n();
  const isAdmin = me.roles.includes("admin");
  const oversight = app === "admin" && isAdmin && view === "all";
  const { items, error } = await getInbox(oversight);
  const base = MESSAGES_BASE[app];
  const isStaff = sideOf(me.roles as MessagingRole[]) === "staff";

  return (
    <div className="animate-fade-up space-y-5">
      <AutoRefresh />
      <PageHeader
        title={t("messaging.inbox.title")}
        description={t(isStaff ? "messaging.inbox.descriptionStaff" : "messaging.inbox.descriptionFamily")}
        actions={<>
          <Link href={`${base}/preferences` as never}><Button size="sm" variant="ghost"><Bell className="h-4 w-4" /> {t("messaging.preferences.short")}</Button></Link>
          {app === "admin" && isAdmin && (
            <Link href="/admin/messages/settings"><Button size="sm" variant="secondary"><Settings className="h-4 w-4" /> {t("messaging.settings.short")}</Button></Link>
          )}
          <Link href={`${base}/new` as never}><Button size="sm"><MessageSquarePlus className="h-4 w-4" /> {t("messaging.compose.newMessage")}</Button></Link>
        </>}
      />
      <p className="flex items-start gap-2 rounded-md border border-border bg-surface p-3 text-xs text-text-muted">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
        <span>{t("messaging.safeguarding.oversight")} {t("messaging.safeguarding.privacy")} {isStaff ? "" : t("messaging.safeguarding.athletes")}</span>
      </p>
      {app === "admin" && isAdmin && (
        <nav className="flex gap-2" aria-label={t("messaging.inbox.views")}>
          {[{ key: "mine", label: t("messaging.inbox.mine") }, { key: "all", label: t("messaging.inbox.all") }].map((v) => {
            const active = (v.key === "all") === oversight;
            return (
              <Link key={v.key} href={v.key === "all" ? "/admin/messages?view=all" : "/admin/messages"} aria-current={active ? "page" : undefined}
                className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-brand-primary bg-brand-primary-soft text-brand-primary" : "border-border text-text-muted hover:text-text")}>
                {v.label}
              </Link>
            );
          })}
        </nav>
      )}
      {error ? <ErrorState title={t("messaging.errors.generic")} /> : (
        <Card className="p-0"><InboxList items={items} base={base} showFamily={isStaff} /></Card>
      )}
    </div>
  );
}

export async function MessageNewPage({ app, to }: { app: MessagingApp; to?: string }) {
  const me = await requireRole(ROLES[app]);
  const { t } = await getI18n();
  const isStaff = sideOf(me.roles as MessagingRole[]) === "staff";
  const [contacts, families, settings, scopes] = await Promise.all([
    getContacts(),
    isStaff ? Promise.resolve([]) : getMyFamilies(me),
    me.orgId ? getMessagingSettings(me.orgId) : Promise.resolve(null),
    me.roles.includes("admin") || me.roles.includes("coach") ? getScopeOptions(me) : Promise.resolve([]),
  ]);
  const writeOffice = canWriteToOffice({ id: me.id, orgId: me.orgId ?? "", roles: me.roles as MessagingRole[], familyIds: families.map((f) => f.id) }, settings?.parentsCanStart ?? true);
  const base = MESSAGES_BASE[app];
  const preset = to && uuid.safeParse(to).success ? contacts.find((c) => c.profile_id === to) : undefined;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        eyebrow={<Link href={base as never} className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> {t("messaging.inbox.title")}</Link>}
        title={t("messaging.compose.title")}
      />
      {!isStaff && !writeOffice && contacts.length === 0 ? (
        <p className="text-sm text-text-muted">{t("messaging.compose.nobody")}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <NewThreadForm contacts={contacts} families={families} canWriteOffice={writeOffice} isStaff={isStaff}
            presetTarget={preset ? `${preset.profile_id}|${preset.family_id ?? ""}` : null} />
          {isStaff && scopes.length > 0 && <NewChannelForm scopes={scopes} />}
        </div>
      )}
    </div>
  );
}

export async function MessageThreadPage({ app, id }: { app: MessagingApp; id: string }) {
  const me = await requireRole(ROLES[app]);
  if (!uuid.safeParse(id).success) notFound();
  const { t } = await getI18n();
  const thread = await getThread(id, me);
  if (!thread) notFound();
  const isAdmin = me.roles.includes("admin");
  const isStaff = sideOf(me.roles as MessagingRole[]) === "staff";
  const canClose = isAdmin || (thread.kind === "channel" && thread.canPost && me.roles.includes("coach") && thread.status === "open") ||
    (thread.kind === "channel" && thread.status === "closed" && me.roles.includes("coach") && thread.isMember);
  const title = threadTitle(t, {
    subject: thread.subject, kind: thread.kind, scope_name: thread.scopeName, office: thread.office, family_name: thread.familyName,
    people: thread.people.filter((p) => p.profile_id !== me.id && p.is_participant).map((p) => p.display_name ?? "?").join(", ") || null,
  });
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        eyebrow={<Link href={MESSAGES_BASE[app] as never} className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> {t("messaging.inbox.title")}</Link>}
        title={title}
        description={[thread.familyName, thread.kind === "channel" ? thread.scopeName : null].filter(Boolean).join(" · ") || undefined}
      />
      <ThreadView thread={thread} meId={me.id} isAdmin={isAdmin} canClose={canClose} isStaff={isStaff} />
    </div>
  );
}

export async function NotificationPreferencesPage({ app }: { app: MessagingApp }) {
  const me = await requireRole(ROLES[app]);
  const { t } = await getI18n();
  const prefs = await getMyPreferences(me);
  const categories: NotificationCategory[] = me.roles.includes("admin") ? ["messages", "alerts", "leads", "announcements"] : ["messages", "alerts", "announcements"];
  return (
    <div className="animate-fade-up max-w-2xl space-y-5">
      <PageHeader
        eyebrow={<Link href={MESSAGES_BASE[app] as never} className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> {t("messaging.inbox.title")}</Link>}
        title={t("messaging.preferences.title")}
        description={t("messaging.preferences.description")}
      />
      <PreferencesForm initial={{ channels: effectiveChannels(prefs.channels), quietStart: prefs.quietStart, quietEnd: prefs.quietEnd }} categories={categories} />
    </div>
  );
}

/** Small card for dashboards / notifications page. */
export function CommunicationCard({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {href && linkLabel && <Link href={href as never} className="text-xs text-brand-primary underline-offset-4 hover:underline">{linkLabel}</Link>}
      </CardHeader>
      {children}
    </Card>
  );
}
