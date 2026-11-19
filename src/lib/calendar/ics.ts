/**
 * Minimal RFC 5545 writer for the read-only calendar subscription feed.
 * Times are written in UTC; all-day items use DATE values with an exclusive
 * end. Only what a calendar app needs: no attendees, no personal details.
 */
import { addDayKey } from "@/lib/staff/hours";
import type { CalendarItem } from "./aggregate";

export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Fold a content line to 75 octets (continuation lines start with a space). */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curLen + len > limit) {
      out.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function utcStamp(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
const dateValue = (key: string) => key.replace(/-/g, "");

export type IcsOptions = { calendarName: string; domain: string; now?: Date; baseUrl?: string | null };

export function buildIcs(items: CalendarItem[], opts: IcsOptions): string {
  const stamp = utcStamp(opts.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DLang OS//Club calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.calendarName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const item of items) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.id.replace(/[^A-Za-z0-9:._-]/g, "")}@${opts.domain}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (item.allDay) {
      const from = item.start.slice(0, 10);
      const to = item.end.slice(0, 10) < from ? from : item.end.slice(0, 10);
      lines.push(`DTSTART;VALUE=DATE:${dateValue(from)}`);
      lines.push(`DTEND;VALUE=DATE:${dateValue(addDayKey(to, 1))}`);
    } else {
      lines.push(`DTSTART:${utcStamp(item.start)}`);
      lines.push(`DTEND:${utcStamp(Date.parse(item.end) > Date.parse(item.start) ? item.end : new Date(Date.parse(item.start) + 3600_000))}`);
    }
    lines.push(`SUMMARY:${icsEscape(item.title)}`);
    if (item.location) lines.push(`LOCATION:${icsEscape(item.location)}`);
    if (item.description) lines.push(`DESCRIPTION:${icsEscape(item.description)}`);
    if (item.status === "cancelled") lines.push("STATUS:CANCELLED");
    if (opts.baseUrl && item.href) lines.push(`URL:${opts.baseUrl.replace(/\/$/, "")}${item.href}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
