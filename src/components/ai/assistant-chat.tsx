"use client";
import * as React from "react";
import Link from "next/link";
import { Sparkles, Send, LifeBuoy, ShieldCheck } from "lucide-react";
import { Card, CardBody, Button } from "@/components/ui";
import { askAssistant, logEscalation, type Scope } from "@/lib/actions/ai";
import { cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant/context";

type Msg = { who: "you" | "ai"; text: string; escalate?: boolean };

const SUGGESTIONS: Record<Scope, string[]> = {
  parent: ["What do I currently owe?", "When is my next booking?", "Which programs is my child registered for?"],
  admin: ["How many overdue invoices are there?", "Summarize this month's registrations", "How much is outstanding?"],
  coach: ["Summarize my recent sessions", "How many athletes did I mark last session?"],
};

export function AssistantChat({ scope, supportHref }: { scope: Scope; supportHref: string }) {
  const tenant = useTenant();
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { who: "you", text: q }]);
    setInput(""); setBusy(true);
    const res = await askAssistant(q, scope);
    setBusy(false);
    setMsgs((m) => [...m, { who: "ai", text: res.answer, escalate: res.escalate }]);
  }

  return (
    <Card className="flex h-[70vh] flex-col">
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
        <Sparkles className="h-4 w-4 text-maroon" />
        <span className="text-sm font-semibold text-ink">{tenant.name} Assistant</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-ink-4"><ShieldCheck className="h-3.5 w-3.5" /> grounded in your records</span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-ink-3">Ask about your {scope === "parent" ? "family, invoices and bookings" : scope === "coach" ? "assigned sessions" : "club operations"}. Answers come only from your records.</p>
            <div className="flex flex-wrap gap-2">{SUGGESTIONS[scope].map((s) => (
              <button key={s} onClick={() => ask(s)} className="rounded-full border border-line bg-surface-elevated px-3 py-1.5 text-xs text-ink-2 hover:text-ink">{s}</button>
            ))}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.who === "you" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", m.who === "you" ? "bg-maroon-soft text-inverse" : "bg-surface-elevated text-ink")}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.escalate && (
                <div className="mt-2 border-t border-line-soft pt-2">
                  <Link href={supportHref as never} onClick={() => logEscalation(msgs[i - 1]?.text ?? "")}>
                    <Button size="sm" variant="secondary"><LifeBuoy className="h-4 w-4" /> Contact {tenant.name}</Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-ink-4">Thinking…</div>}
        <div ref={endRef} />
      </div>

      <CardBody className="border-t border-line-soft">
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" className="flex-1 rounded-full border border-line bg-surface-input px-4 py-2 text-sm text-ink" />
          <Button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
        <p className="mt-2 text-center text-[11px] text-ink-4">AI can make mistakes. For medical, payment or sensitive matters, contact the club directly.</p>
      </CardBody>
    </Card>
  );
}
