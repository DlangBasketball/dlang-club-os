import { History } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import type { ProfileHistoryEntry } from "@/lib/participants/admin-data";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";

const DATE_FIELDS = new Set(["dob"]);
const ID_FIELDS = new Set(["player_profile_id", "family_id", "merged_into_id", "merged_athlete_id", "kept_athlete_id"]);

/** One value as staff read it, in the club's locale (ids never shown raw). */
function show(field: string, v: unknown, t: Translator, f: Formatter): string {
  if (v === null || v === undefined || v === "") return "—";
  if (ID_FIELDS.has(field)) return t("myAthletes.history.linked");
  if (DATE_FIELDS.has(field) && typeof v === "string") return f.date(v);
  if (field === "gender" && typeof v === "string") return t.dynamic(`participants.sex.${v.toLowerCase()}`, undefined, v);
  if (field === "status" && typeof v === "string") return t.dynamic(`status.${v}`, undefined, v);
  if (typeof v === "number") return f.number(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && (field === "height_cm" || field === "weight_kg")) return f.number(Number(v));
  return String(v);
}

/**
 * Admin-only profile history of an athlete: who created / changed / linked /
 * merged / approved / declined profile data, by which path, before → after.
 * Read through athlete_profile_history() (admin of the club only).
 */
export function ProfileHistory({ entries, t, f }: { entries: ProfileHistoryEntry[]; t: Translator; f: Formatter }) {
  return (
    <Card>
      <CardHeader><CardTitle>{t("myAthletes.history.title")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {entries.length === 0 ? (
          <div className="p-5"><EmptyState icon={<History className="h-5 w-5" />} title={t("myAthletes.history.empty")} /></div>
        ) : (
          <ol>
            {entries.map((e) => {
              const reason = e.reason?.startsWith("club_request:") || /^[0-9a-f-]{36}$/i.test(e.reason ?? "")
                ? t("myAthletes.history.reasonClubRequest") : e.reason;
              return (
                <li key={e.id} className="space-y-1 border-b border-border-soft px-5 py-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text">{t.dynamic(`myAthletes.history.actions.${e.action.replaceAll(".", "_")}`, undefined, e.action)}</span>
                    {e.via && <Badge tone="neutral">{t.dynamic(`myAthletes.history.via.${e.via}`, undefined, e.via)}</Badge>}
                  </div>
                  <p className="text-xs text-text-muted">
                    {f.dateTime(e.at)} · {e.actorName ?? t("myAthletes.history.system")}{reason ? ` · ${reason}` : ""}
                  </p>
                  {e.changes.length > 0 && (
                    <ul className="text-xs text-text-secondary">
                      {e.changes.map((c) => (
                        <li key={c.field}>
                          {t.dynamic(`myAthletes.history.fields.${c.field}`, undefined, c.field)}: {show(c.field, c.before, t, f)} → {show(c.field, c.after, t, f)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
