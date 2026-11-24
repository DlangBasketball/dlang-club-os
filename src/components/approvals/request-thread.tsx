import type { ClubRequestMessage } from "@/lib/approvals/types";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";

/** Messages between the family and the club on one request (oldest first). */
export function RequestThread({ messages, t, f, viewer }: { messages: ClubRequestMessage[]; t: Translator; f: Formatter; viewer: "family" | "club" }) {
  const shown = messages.filter((m) => m.body);
  if (!shown.length) return null;
  return (
    <ol className="space-y-2" aria-label={t("approvals.thread.title")}>
      {shown.map((m, i) => {
        const mine = m.side === viewer;
        return (
          <li key={i} className={`rounded-md border px-3 py-2 text-sm ${mine ? "border-border bg-surface" : "border-brand-primary/30 bg-brand-primary-soft"}`}>
            <div className="mb-0.5 text-xs text-text-muted">
              {t.dynamic(`approvals.thread.kind.${m.kind}`, { side: t(m.side === "family" ? "approvals.thread.family" : "approvals.thread.club") }, m.kind)}
              {" · "}{f.dateTime(m.at, "medium")}
            </div>
            <p className="whitespace-pre-wrap break-words text-text">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
