"use client";

import * as React from "react";
import Link from "next/link";
import { Car, Hand, MessagesSquare, Sparkles } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { useFormat, useT } from "@/lib/i18n/client";
import { cancelCarpoolMatch, matchCarpool, postCarpoolOffer, postCarpoolRequest, withdrawCarpoolPost } from "@/lib/actions/carpool";
import type { CarpoolBoardView } from "@/lib/family/data";
import { seatsLeft } from "@/lib/family/carpool";
import { threadPath, type MessagingApp } from "@/lib/messaging/paths";
import { StatusLine, useFamilyAction } from "./use-family-action";

/** "YYYY-MM-DDTHH:MM" in the browser's zone, for <input type="datetime-local">. */
function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function OfferForm({ view }: { view: CarpoolBoardView }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [fromArea, setFrom] = React.useState("");
  const [departsAt, setDeparts] = React.useState(localInput(new Date(Date.parse(view.event.startsAt) - 3600_000).toISOString()));
  const [seats, setSeats] = React.useState("3");
  const [returnTrip, setReturn] = React.useState(false);
  const [note, setNote] = React.useState("");
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await run(() => postCarpoolOffer({ eventId: view.event.id, fromArea, departsAt: new Date(departsAt).toISOString(), seats: Number(seats), returnTrip, note }))) {
        setFrom(""); setNote("");
      }
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="off-from">{t("family.carpool.fromArea")}</Label>
          <Input id="off-from" required minLength={2} maxLength={120} value={fromArea} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="off-seats">{t("family.carpool.seats")}</Label>
          <Input id="off-seats" type="number" min={1} max={8} required value={seats} onChange={(e) => setSeats(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="off-dep">{t("family.carpool.departsAt")}</Label>
          <Input id="off-dep" type="datetime-local" required value={departsAt} onChange={(e) => setDeparts(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="off-note">{t("family.carpool.note")}</Label>
          <Textarea id="off-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={returnTrip} onChange={(e) => setReturn(e.target.checked)} /> {t("family.carpool.returnTrip")}</label>
      <FieldHint>{t("family.carpool.privacyHint")}</FieldHint>
      <StatusLine msg={msg} />
      <Button type="submit" loading={busy} disabled={busy}>{t("family.carpool.offerSeats")}</Button>
    </form>
  );
}

function RequestForm({ view }: { view: CarpoolBoardView }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [fromArea, setFrom] = React.useState("");
  const [seats, setSeats] = React.useState("1");
  const [returnTrip, setReturn] = React.useState(false);
  const [note, setNote] = React.useState("");
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await run(() => postCarpoolRequest({ eventId: view.event.id, fromArea, seats: Number(seats), returnTrip, note }))) {
        setFrom(""); setNote("");
      }
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="req-from">{t("family.carpool.fromArea")}</Label>
          <Input id="req-from" required minLength={2} maxLength={120} value={fromArea} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="req-seats">{t("family.carpool.seatsNeeded")}</Label>
          <Input id="req-seats" type="number" min={1} max={6} required value={seats} onChange={(e) => setSeats(e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="req-note">{t("family.carpool.note")}</Label>
          <Textarea id="req-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={returnTrip} onChange={(e) => setReturn(e.target.checked)} /> {t("family.carpool.returnTrip")}</label>
      <StatusLine msg={msg} />
      <Button type="submit" variant="secondary" loading={busy} disabled={busy}>{t("family.carpool.requestSeat")}</Button>
    </form>
  );
}

/** Event carpool board: offers, requests, suggested matches, my matches (with the private thread). */
export function CarpoolBoardPanel({ view, app }: { view: CarpoolBoardView; app: MessagingApp }) {
  const t = useT();
  const f = useFormat();
  const { busy, msg, run } = useFamilyAction();
  const { offers, requests, matches } = view.board;
  const myRequests = requests.filter((r) => r.mine && r.status === "open");
  const myOffers = offers.filter((o) => o.mine && o.status === "open");
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const reqById = new Map(requests.map((r) => [r.id, r]));

  return (
    <div className="space-y-5">
      <StatusLine msg={msg} />
      {view.suggestions.length > 0 && (view.canManage || myRequests.length > 0 || myOffers.length > 0) && (
        <Card>
          <CardHeader className="flex items-center gap-2"><Sparkles aria-hidden className="h-4 w-4 text-brand-accent" /><CardTitle>{t("family.carpool.suggestions")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {view.suggestions
                .filter((s) => view.canManage || offerById.get(s.offerId)?.mine || reqById.get(s.requestId)?.mine)
                .map((s) => {
                  const o = offerById.get(s.offerId)!;
                  const r = reqById.get(s.requestId)!;
                  return (
                    <li key={`${s.offerId}-${s.requestId}`} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-text-secondary">{t("family.carpool.suggestion", { driver: o.name, passenger: r.name, from: o.from_area, seats: r.seats_needed })}</span>
                      <Button size="sm" disabled={busy} onClick={() => run(() => matchCarpool({ offerId: o.id, requestId: r.id }))}>{t("family.carpool.match")}</Button>
                    </li>
                  );
                })}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center gap-2"><Car aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.carpool.offers")}</CardTitle></CardHeader>
          <CardBody>
            {offers.length === 0 ? <p className="text-sm text-text-muted">{t("family.carpool.noOffers")}</p> : (
              <ul className="space-y-3 text-sm">
                {offers.map((o) => (
                  <li key={o.id} className="space-y-1 border-b border-border pb-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text">{o.name || t("family.carpool.someone")}</span>
                      {o.mine && <Badge>{t("family.guardians.you")}</Badge>}
                      <Badge tone={o.status === "full" ? "neutral" : "success"}>{t("family.carpool.seatsLeft", { count: seatsLeft({ seatsTotal: o.seats_total, seatsTaken: o.seats_taken }), total: o.seats_total })}</Badge>
                      {o.return_trip && <Badge tone="info">{t("family.carpool.returnTrip")}</Badge>}
                    </div>
                    <p className="text-text-secondary">{t("family.carpool.fromAt", { from: o.from_area, time: f.dateTime(o.departs_at) })}</p>
                    {o.note && <p className="text-xs text-text-muted">{o.note}</p>}
                    <div className="flex flex-wrap gap-2">
                      {!o.mine && o.status === "open" && myRequests.filter((r) => r.seats_needed <= o.seats_total - o.seats_taken).map((r) => (
                        <Button key={r.id} size="sm" disabled={busy} onClick={() => run(() => matchCarpool({ offerId: o.id, requestId: r.id }))}>{t("family.carpool.join", { seats: r.seats_needed })}</Button>
                      ))}
                      {(o.mine || view.canManage) && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => withdrawCarpoolPost({ kind: "offer", id: o.id }))}>{t("family.carpool.withdraw")}</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader className="flex items-center gap-2"><Hand aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.carpool.requests")}</CardTitle></CardHeader>
          <CardBody>
            {requests.length === 0 ? <p className="text-sm text-text-muted">{t("family.carpool.noRequests")}</p> : (
              <ul className="space-y-3 text-sm">
                {requests.map((r) => (
                  <li key={r.id} className="space-y-1 border-b border-border pb-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text">{r.name || t("family.carpool.someone")}</span>
                      {r.mine && <Badge>{t("family.guardians.you")}</Badge>}
                      <Badge tone={r.status === "matched" ? "success" : "warning"}>{t(`family.carpool.requestStatus.${r.status}`)}</Badge>
                    </div>
                    <p className="text-text-secondary">{t("family.carpool.needsFrom", { seats: r.seats_needed, from: r.from_area })}</p>
                    {r.note && <p className="text-xs text-text-muted">{r.note}</p>}
                    <div className="flex flex-wrap gap-2">
                      {!r.mine && r.status === "open" && myOffers.filter((o) => r.seats_needed <= o.seats_total - o.seats_taken).map((o) => (
                        <Button key={o.id} size="sm" disabled={busy} onClick={() => run(() => matchCarpool({ offerId: o.id, requestId: r.id }))}>{t("family.carpool.accept")}</Button>
                      ))}
                      {(r.mine || view.canManage) && r.status === "open" && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => withdrawCarpoolPost({ kind: "request", id: r.id }))}>{t("family.carpool.withdraw")}</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {matches.length > 0 && (
        <Card>
          <CardHeader className="flex items-center gap-2"><MessagesSquare aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.carpool.matches")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {matches.map((m) => {
                const o = offerById.get(m.offer_id);
                const r = reqById.get(m.request_id);
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-text-secondary">{t("family.carpool.matchLine", { driver: o?.name ?? "—", passenger: r?.name ?? "—", seats: m.seats })}</span>
                    <span className="flex gap-2">
                      {m.conversation_id && (
                        <Link href={threadPath(app, m.conversation_id) as never} className="text-brand-primary underline-offset-4 hover:underline">{t("family.carpool.openThread")}</Link>
                      )}
                      {(m.mine || view.canManage) && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => cancelCarpoolMatch(m.id))}>{t("family.carpool.cancelMatch")}</Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      {view.canPost && app === "parent" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>{t("family.carpool.offerSeats")}</CardTitle></CardHeader><CardBody><OfferForm view={view} /></CardBody></Card>
          <Card><CardHeader><CardTitle>{t("family.carpool.requestSeat")}</CardTitle></CardHeader><CardBody><RequestForm view={view} /></CardBody></Card>
        </div>
      )}
    </div>
  );
}
