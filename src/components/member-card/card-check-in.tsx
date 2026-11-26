"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RollCallScanner } from "@/components/attendance/roll-call-scanner";
import { checkInWithCard } from "@/lib/actions/member-cards";
import { newRequestId } from "@/lib/billing/request-id";
import { useT } from "@/lib/i18n/client";

/**
 * Member card check-in above a team / booked-session attendance sheet. Each
 * scan is checked in on the server (member_card_check_in -> the event's
 * sheet), with one request id per scan (a network retry of the same scan is
 * replayed, not duplicated). After a check-in the page refreshes so the
 * sheet shows the saved mark; unsaved taps stay in the sheet's local draft.
 */
export function CardCheckIn({ eventId }: { eventId: string }) {
  const t = useT();
  const router = useRouter();
  const check = React.useCallback(async (raw: string) => {
    const res = await checkInWithCard(eventId, raw, newRequestId());
    if (!res.ok || !res.data) return { ok: false, text: res.ok ? t("memberCard.checkIn.codes.UNKNOWN_CARD") : res.error };
    router.refresh();
    return {
      ok: true,
      text: res.data.outcome === "already"
        ? t("memberCard.checkIn.already", { name: res.data.name })
        : t("memberCard.checkIn.done", { name: res.data.name }),
    };
  }, [eventId, router, t]);
  return <RollCallScanner check={check} />;
}
